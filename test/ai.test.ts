import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../shared/directory';
import { costMicro, recordAiUsage } from '../worker/aiBudget';
import app from '../worker/index';

const BASE = 'https://app.nowstocking.com';
const OPERATOR = 'operator@example.com';
const HOSTED = {
  ...env, SIGNUP_MODE: 'open', EXPOSE_LOGIN_CODES: 'true', AI_ALLOWANCE_USD: '1', AI_MONTHLY_CAP_USD: '0', OPERATOR_EMAILS: OPERATOR,
} as unknown as Env;

let seq = 0;
const email = (n: string) => `${n}-${++seq}-ai@example.com`;

async function call<T>(user: string, path: string, init: RequestInit = {}, e: Env = HOSTED) {
  const headers = new Headers(init.headers);
  headers.set('X-Dev-User', user);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await app.fetch(new Request(BASE + path, { ...init, headers }), e);
  return { status: res.status, body: (await res.json()) as T };
}

async function newAccount(e: Env = HOSTED) {
  const user = email('user');
  const me = (await call<MeResponse>(user, '/api/me', {}, e)).body;
  return { user, accountId: me.accounts[0].id, wid: me.accounts[0].warehouses[0].id };
}

/** A photo job ready to start reading. */
async function uploadedJob(user: string, wid: string, e: Env = HOSTED) {
  const job = (await call<{ id: string }>(user, `/api/w/${wid}/import/jobs`, { method: 'POST', body: JSON.stringify({ page_count: 1 }) }, e)).body.id;
  await app.fetch(new Request(`${BASE}/api/w/${wid}/import/jobs/${job}/pages/1`, {
    method: 'PUT', headers: { 'X-Dev-User': user, 'content-type': 'image/jpeg' }, body: new Uint8Array([1, 2, 3]),
  }), e);
  return job;
}

const spend = (accountId: string, usd: number) => env.DB.prepare(
  `INSERT INTO ai_usage (account_id, warehouse_id, model, input_tokens, output_tokens, cost_micro, created_at) VALUES (?, 'w', 'claude-opus-5', 0, 0, ?, ?)`,
).bind(accountId, Math.round(usd * 1e6), new Date().toISOString()).run();

describe('cost', () => {
  it('prices calls from token counts', () => {
    expect(costMicro('claude-opus-5', { input_tokens: 1000, output_tokens: 2000 })).toBe(55_000); // $0.055
    expect(costMicro('claude-opus-4-8', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1000, cache_read_input_tokens: 10_000 }))
      .toBe(Math.ceil(1250 * 5 + 1000 * 5)); // cache writes 1.25×, reads 0.1×
    expect(costMicro('some-future-model', { input_tokens: 1000, output_tokens: 1000 })).toBe(60_000); // priced at the most expensive
  });
});

describe('AI allowance', () => {
  it('cuts an account off when its allowance is used, and says so', async () => {
    const a = await newAccount();
    const job = await uploadedJob(a.user, a.wid);
    await spend(a.accountId, 1.0);
    const res = await call<{ error: string }>(a.user, `/api/w/${a.wid}/import/jobs/${job}/start`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/free photo-reading allowance \(\$1\.00\)/);
    const usage = await call<{ ai: { allowed: boolean; spent_usd: number; allowance_usd: number } }>(a.user, `/api/accounts/${a.accountId}/usage`);
    expect(usage.body.ai).toMatchObject({ allowed: false, spent_usd: 1, allowance_usd: 1 });
    // Everything else keeps working.
    expect((await call(a.user, `/api/w/${a.wid}/sync`)).status).toBe(200);
  });

  it('pauses photo reading for everyone at the monthly cap', async () => {
    const capped = { ...HOSTED, AI_MONTHLY_CAP_USD: '0.000001' } as unknown as Env; // any spend this month reaches it
    const other = await newAccount(capped);
    await spend(other.accountId, 0.01);
    const a = await newAccount(capped);
    const job = await uploadedJob(a.user, a.wid, capped);
    const res = await call<{ error: string }>(a.user, `/api/w/${a.wid}/import/jobs/${job}/start`, { method: 'POST', body: '{}' }, capped);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/paused for everyone/);
  });

  it('records calls and alerts the operator once when an allowance runs out', async () => {
    const a = await newAccount();
    const base = { accountId: a.accountId, warehouseId: a.wid, jobId: 'j', page: 1, kind: 'packing_list', model: 'claude-opus-5' };
    await recordAiUsage(HOSTED, { ...base, usage: { input_tokens: 2000, output_tokens: 20_000 } }); // $0.51
    let alerts = await env.DB.prepare('SELECT key FROM alerts WHERE key LIKE ?').bind(`allowance:${a.accountId}:%`).all();
    expect(alerts.results).toHaveLength(0);
    await recordAiUsage(HOSTED, { ...base, usage: { input_tokens: 2000, output_tokens: 20_000 } }); // $1.02 total
    await recordAiUsage(HOSTED, { ...base, usage: { input_tokens: 10, output_tokens: 10 } });
    alerts = await env.DB.prepare('SELECT key FROM alerts WHERE key LIKE ?').bind(`allowance:${a.accountId}:%`).all();
    expect(alerts.results).toHaveLength(1);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS n, SUM(cost_micro) AS micro FROM ai_usage WHERE account_id = ?').bind(a.accountId).first<{ n: number; micro: number }>();
    expect(rows).toMatchObject({ n: 3, micro: 510_000 * 2 + costMicro('claude-opus-5', { input_tokens: 10, output_tokens: 10 }) });
  });
});

describe('operator admin', () => {
  it('is invisible to everyone else', async () => {
    const a = await newAccount();
    expect((await call(a.user, '/api/admin/overview')).status).toBe(404);
    expect((await call<MeResponse>(a.user, '/api/me')).body.operator).toBe(false);
    expect((await call<MeResponse>(OPERATOR, '/api/me')).body.operator).toBe(true);
  });

  it('shows per-account usage and can raise an allowance or switch an account off', async () => {
    const a = await newAccount();
    await spend(a.accountId, 1.25);
    const overview = await call<{ accounts: { id: string; ai_total_usd: number; owner: string; allowance_override: boolean }[]; totals: { total_usd: number } }>(OPERATOR, '/api/admin/overview');
    expect(overview.status).toBe(200);
    const row = overview.body.accounts.find((x) => x.id === a.accountId)!;
    expect(row).toMatchObject({ ai_total_usd: 1.25, owner: a.user, allowance_override: false });
    expect(overview.body.totals.total_usd).toBeGreaterThanOrEqual(1.25);

    const job = await uploadedJob(a.user, a.wid);
    const start = () => call<{ error?: string }>(a.user, `/api/w/${a.wid}/import/jobs/${job}/start`, { method: 'POST', body: JSON.stringify({ pages: [1] }) });
    expect((await start()).status).toBe(409);

    expect((await call(OPERATOR, `/api/admin/accounts/${a.accountId}`, { method: 'PATCH', body: JSON.stringify({ ai_allowance_usd: 10 }) })).status).toBe(200);
    expect((await call<{ ai: { allowed: boolean } }>(a.user, `/api/accounts/${a.accountId}/usage`)).body.ai.allowed).toBe(true);

    expect((await call(OPERATOR, `/api/admin/accounts/${a.accountId}`, { method: 'PATCH', body: JSON.stringify({ suspended: true }) })).status).toBe(200);
    const off = await start();
    expect(off.status).toBe(409);
    expect(off.body.error).toMatch(/turned off/);
  });
});
