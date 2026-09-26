// Operator-only: usage across all accounts, and per-account AI controls. OPERATOR_EMAILS decides who.
import { Hono } from 'hono';
import { allowanceDefault, monthlyCap, operatorEmails } from './aiBudget';
import type { AppEnv } from './auth';

export const admin = new Hono<AppEnv>();

admin.use('*', async (c, next) => {
  if (!operatorEmails(c.env).includes(c.get('email'))) return c.json({ error: 'not found' }, 404);
  return next();
});

const monthStart = () => `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`;

export interface AdminAccount {
  id: string; name: string; created_at: string; owner: string | null; members: number; warehouses: number;
  photo_pages_month: number; ai_calls: number; ai_month_usd: number; ai_total_usd: number; last_ai_at: string | null;
  ai_allowance_usd: number | null; allowance_override: boolean; suspended: boolean;
}

admin.get('/overview', async (c) => {
  const month = monthStart();
  const ym = month.slice(0, 7);
  const [accounts, totals, users] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT a.id, a.name, a.created_at, a.ai_allowance_usd, a.ai_suspended_at,
         (SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = a.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1) AS owner,
         (SELECT COUNT(*) FROM memberships m WHERE m.account_id = a.id) AS members,
         (SELECT COUNT(*) FROM warehouses w WHERE w.account_id = a.id AND w.archived_at IS NULL) AS warehouses,
         COALESCE((SELECT photo_pages FROM usage g WHERE g.account_id = a.id AND g.month = ?), 0) AS photo_pages_month,
         (SELECT COUNT(*) FROM ai_usage x WHERE x.account_id = a.id) AS ai_calls,
         COALESCE((SELECT SUM(cost_micro) FROM ai_usage x WHERE x.account_id = a.id AND x.created_at >= ?), 0) AS month_micro,
         COALESCE((SELECT SUM(cost_micro) FROM ai_usage x WHERE x.account_id = a.id), 0) AS total_micro,
         (SELECT MAX(created_at) FROM ai_usage x WHERE x.account_id = a.id) AS last_ai_at
       FROM accounts a ORDER BY total_micro DESC, a.created_at DESC LIMIT 500`,
    ).bind(ym, month),
    c.env.DB.prepare(
      `SELECT COALESCE(SUM(CASE WHEN created_at >= ? THEN cost_micro END), 0) AS month_micro, COALESCE(SUM(cost_micro), 0) AS total_micro,
              COUNT(CASE WHEN created_at >= ? THEN 1 END) AS month_calls FROM ai_usage`,
    ).bind(month, month),
    c.env.DB.prepare('SELECT COUNT(*) AS users, (SELECT COUNT(*) FROM accounts) AS accounts FROM users'),
  ]);
  const dflt = allowanceDefault(c.env);
  const t = totals.results[0] as { month_micro: number; total_micro: number; month_calls: number };
  const u = users.results[0] as { users: number; accounts: number };
  return c.json({
    month: ym,
    settings: { allowance_usd: dflt || null, monthly_cap_usd: monthlyCap(c.env) || null },
    totals: { month_usd: t.month_micro / 1e6, total_usd: t.total_micro / 1e6, month_calls: t.month_calls, users: u.users, accounts: u.accounts },
    accounts: (accounts.results as Record<string, unknown>[]).map((a): AdminAccount => ({
      id: a.id as string, name: a.name as string, created_at: a.created_at as string, owner: a.owner as string | null,
      members: a.members as number, warehouses: a.warehouses as number, photo_pages_month: a.photo_pages_month as number,
      ai_calls: a.ai_calls as number, ai_month_usd: (a.month_micro as number) / 1e6, ai_total_usd: (a.total_micro as number) / 1e6,
      last_ai_at: a.last_ai_at as string | null,
      ai_allowance_usd: a.ai_allowance_usd != null ? (a.ai_allowance_usd as number) : dflt || null,
      allowance_override: a.ai_allowance_usd != null, suspended: !!a.ai_suspended_at,
    })),
  });
});

/** Set an account's AI allowance (null = back to the default) and/or switch its photo reading off or on. */
admin.patch('/accounts/:id', async (c) => {
  const body = await c.req.json<{ ai_allowance_usd?: number | null; suspended?: boolean }>().catch(() => null);
  if (!body) return c.json({ error: 'bad request' }, 400);
  const id = c.req.param('id');
  if (!(await c.env.DB.prepare('SELECT 1 FROM accounts WHERE id = ?').bind(id).first())) return c.json({ error: 'not found' }, 404);
  const stmts: D1PreparedStatement[] = [];
  if ('ai_allowance_usd' in body) {
    const v = body.ai_allowance_usd;
    if (v !== null && !(typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000)) return c.json({ error: 'Allowance must be 0–10000 or null.' }, 400);
    stmts.push(c.env.DB.prepare('UPDATE accounts SET ai_allowance_usd = ? WHERE id = ?').bind(v, id));
    // A new allowance can trigger a new "used up" alert later.
    stmts.push(c.env.DB.prepare(`DELETE FROM alerts WHERE key LIKE ?`).bind(`allowance:${id}:%`));
  }
  if (typeof body.suspended === 'boolean') {
    stmts.push(c.env.DB.prepare('UPDATE accounts SET ai_suspended_at = ? WHERE id = ?').bind(body.suspended ? new Date().toISOString() : null, id));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
