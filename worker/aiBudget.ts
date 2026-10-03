// Claude usage: what each call cost, and whether an account may make another.
//
// Settings (wrangler vars):
//   AI_ALLOWANCE_USD     free AI allowance per account, lifetime, in USD. 0 = unlimited.
//   AI_MONTHLY_CAP_USD   spend across all accounts per calendar month (UTC). 0 = unlimited.
//   OPERATOR_EMAILS      comma-separated; they see /admin and get alerts.

/** USD per million tokens. Update when Anthropic's prices change. Unknown models use the highest listed. */
const PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const MOST_EXPENSIVE = { input: 10, output: 50 };

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** Cost in micro-dollars. Cache writes bill at 1.25× input, cache reads at 0.1×. */
export function costMicro(model: string, u: TokenUsage): number {
  const p = PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')] ?? MOST_EXPENSIVE;
  const input = u.input_tokens + 1.25 * (u.cache_creation_input_tokens ?? 0) + 0.1 * (u.cache_read_input_tokens ?? 0);
  return Math.ceil(input * p.input + u.output_tokens * p.output); // tokens × $/M = micro-dollars
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};
export const allowanceDefault = (env: Env) => num((env as { AI_ALLOWANCE_USD?: string }).AI_ALLOWANCE_USD);
export const monthlyCap = (env: Env) => num((env as { AI_MONTHLY_CAP_USD?: string }).AI_MONTHLY_CAP_USD);

export function operatorEmails(env: Env): string[] {
  return String((env as { OPERATOR_EMAILS?: string }).OPERATOR_EMAILS ?? '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

export interface AiStatus {
  spent_usd: number;
  month_usd: number;
  allowance_usd: number | null; // null = unlimited
  suspended: boolean;
  paused_for_everyone: boolean; // the monthly cap across all accounts is reached
  allowed: boolean;
}

export async function aiStatus(env: Env, accountId: string): Promise<AiStatus> {
  const [acct, spend, global] = await env.DB.batch([
    env.DB.prepare('SELECT ai_allowance_usd, ai_suspended_at FROM accounts WHERE id = ?').bind(accountId),
    env.DB.prepare(
      `SELECT COALESCE(SUM(cost_micro), 0) AS total, COALESCE(SUM(CASE WHEN created_at >= ? THEN cost_micro END), 0) AS month
       FROM ai_usage WHERE account_id = ?`,
    ).bind(monthStart(), accountId),
    env.DB.prepare('SELECT COALESCE(SUM(cost_micro), 0) AS month FROM ai_usage WHERE created_at >= ?').bind(monthStart()),
  ]);
  const a = acct.results[0] as { ai_allowance_usd: number | null; ai_suspended_at: string | null } | undefined;
  const s = spend.results[0] as { total: number; month: number };
  const g = global.results[0] as { month: number };
  const allowance = a?.ai_allowance_usd != null ? a.ai_allowance_usd : allowanceDefault(env) || null;
  const spent = s.total / 1e6;
  const cap = monthlyCap(env);
  const paused = cap > 0 && g.month / 1e6 >= cap;
  const suspended = !!a?.ai_suspended_at;
  return {
    spent_usd: spent,
    month_usd: s.month / 1e6,
    allowance_usd: allowance && allowance > 0 ? allowance : null,
    suspended,
    paused_for_everyone: paused,
    allowed: !suspended && !paused && !(allowance && allowance > 0 && spent >= allowance),
  };
}

/** Throws "409: …" (the Worker's HTTP error convention) when this account may not use AI right now. */
export async function assertAiAllowed(env: Env, accountId: string) {
  const s = await aiStatus(env, accountId);
  if (s.allowed) return;
  if (s.suspended) throw new Error('409: Photo reading is turned off for this workshop. Contact support to turn it back on.');
  if (s.paused_for_everyone) throw new Error('409: Photo reading is paused for everyone until next month. Everything else still works.');
  throw new Error(`409: This workshop has used its free photo-reading allowance ($${s.allowance_usd!.toFixed(2)}). Everything else still works.`);
}

async function alertOnce(env: Env, key: string, subject: string, text: string) {
  const to = operatorEmails(env);
  if (!to.length) return;
  const fresh = await env.DB.prepare('INSERT OR IGNORE INTO alerts (key, sent_at) VALUES (?, ?)').bind(key, new Date().toISOString()).run();
  if (!fresh.meta.changes) return; // already sent
  if ((env as { EXPOSE_LOGIN_CODES?: string }).EXPOSE_LOGIN_CODES === 'true') return; // tests
  try {
    await env.EMAIL.send({ to, from: { email: env.EMAIL_FROM, name: 'NowStocking alerts' }, subject, text });
  } catch (e) {
    console.error('alert email failed', key, e);
  }
}

/** Tell the operators someone new signed in for the first time. */
export async function alertSignup(env: Env, userId: string, email: string, workshops: string[]) {
  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  const user = await env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first<{ name: string | null }>();
  await alertOnce(env, `signup:${userId}`, `New sign-up: ${email}`,
    `${user?.name ? `${user.name} (${email})` : email} just signed up for NowStocking.\n\n` +
    `Workshop: ${workshops.join(', ') || 'none yet'}\n` +
    `Users in total: ${users?.n ?? '?'}`);
}

/** Record one Claude call, then alert the operator if it crossed a limit. */
export async function recordAiUsage(env: Env, u: {
  accountId: string; warehouseId: string; jobId: string; page: number; kind: string; model: string; usage: TokenUsage;
}) {
  const cost = costMicro(u.model, u.usage);
  await env.DB.prepare(
    `INSERT INTO ai_usage (account_id, warehouse_id, job_id, page, kind, model, input_tokens, output_tokens, cost_micro, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    u.accountId, u.warehouseId, u.jobId, u.page, u.kind, u.model,
    u.usage.input_tokens + (u.usage.cache_creation_input_tokens ?? 0) + (u.usage.cache_read_input_tokens ?? 0),
    u.usage.output_tokens, cost, new Date().toISOString(),
  ).run();

  const s = await aiStatus(env, u.accountId);
  if (s.allowance_usd && s.spent_usd >= s.allowance_usd) {
    const name = (await env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(u.accountId).first<{ name: string }>())?.name;
    await alertOnce(env, `allowance:${u.accountId}:${s.allowance_usd}`, `NowStocking: "${name}" used its AI allowance`,
      `Account "${name}" (${u.accountId}) has used $${s.spent_usd.toFixed(2)} of its $${s.allowance_usd.toFixed(2)} AI allowance. Photo reading is now off for it. Raise its allowance on the admin page to turn it back on.`);
  }
  const cap = monthlyCap(env);
  if (cap) {
    const g = await env.DB.prepare('SELECT COALESCE(SUM(cost_micro), 0) AS month FROM ai_usage WHERE created_at >= ?').bind(monthStart()).first<{ month: number }>();
    const month = (g?.month ?? 0) / 1e6;
    const ym = new Date().toISOString().slice(0, 7);
    for (const pct of [80, 100]) {
      if (month >= (cap * pct) / 100) {
        await alertOnce(env, `global:${ym}:${pct}`, `NowStocking: AI spend at ${pct}% of the monthly cap`,
          `AI spend this month is $${month.toFixed(2)} of the $${cap.toFixed(2)} cap.${pct === 100 ? ' Photo reading is now paused for everyone until next month.' : ''}`);
      }
    }
  }
  return cost;
}
