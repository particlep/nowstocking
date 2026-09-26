import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../shared/directory';
import type { Mutation, SyncResponse } from '../shared/schema';
import app from '../worker/index';

const BASE = 'https://app.nowstocking.com';
const OPEN = { ...env, SIGNUP_MODE: 'open', EXPOSE_LOGIN_CODES: 'true' } as unknown as Env;
let seq = 0;
const email = (name: string) => `${name}-${++seq}-del@example.com`;

async function call<T>(user: string, path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('X-Dev-User', user);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await app.fetch(new Request(BASE + path, { ...init, headers }), OPEN);
  return { status: res.status, body: (await res.json()) as T };
}

const me = async (user: string) => (await call<MeResponse>(user, '/api/me')).body;
const del = (user: string, confirm = 'DELETE') =>
  call<{ ok?: boolean; error?: string; deletedAccounts?: string[]; leftAccounts?: string[]; photosDeleted?: number }>(
    user, '/api/me/delete', { method: 'POST', body: JSON.stringify({ confirm }) });

function addKit(wid: string, user: string, code: string) {
  const m: Mutation = { id: crypto.randomUUID(), label: 'kit', created_at: new Date().toISOString(),
    ops: [{ op: 'insert', table: 'kits', id: 2 ** 34 + ++seq, fields: { code, name: code } }] };
  return call(user, `/api/w/${wid}/mutations`, { method: 'POST', body: JSON.stringify({ mutations: [m] }) });
}

describe('deleting an account', () => {
  it('needs an explicit confirmation', async () => {
    const user = email('careful');
    await me(user);
    expect((await del(user, 'yes')).status).toBe(400);
    expect((await me(user)).accounts).toHaveLength(1);
  });

  it('erases a solo account: warehouses, photos and the user', async () => {
    const user = email('solo');
    const account = (await me(user)).accounts[0];
    const wid = account.warehouses[0].id;
    await addKit(wid, user, 'SOLO');
    const job = (await call<{ id: string }>(user, `/api/w/${wid}/import/jobs`, { method: 'POST', body: JSON.stringify({ page_count: 1 }) })).body.id;
    await app.fetch(new Request(`${BASE}/api/w/${wid}/import/jobs/${job}/pages/1`, {
      method: 'PUT', headers: { 'X-Dev-User': user, 'content-type': 'image/jpeg' }, body: new Uint8Array([1, 2, 3]),
    }), OPEN);

    const res = await del(user);
    expect(res.status).toBe(200);
    expect(res.body.deletedAccounts).toEqual([account.name]);
    expect(res.body.photosDeleted).toBe(1);
    expect((await env.IMPORTS.list({ prefix: `w/${wid}/` })).objects).toHaveLength(0);
    expect(await env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(user).first()).toBeNull();
    expect(await env.DB.prepare('SELECT 1 FROM warehouses WHERE id = ?').bind(wid).first()).toBeNull();

    // Signing in again starts fresh: a new account, and the old warehouse's data is gone.
    const again = (await me(user)).accounts[0];
    expect(again.id).not.toBe(account.id);
    const stub = env.WAREHOUSE.get(env.WAREHOUSE.idFromName(wid));
    expect((await stub.sync(0)).rows.kits.map((k) => k.code)).toEqual(['MISC']);
  });

  it('leaves a shared account and removes their email from its history', async () => {
    const owner = email('owner');
    const account = (await me(owner)).accounts[0];
    const wid = account.warehouses[0].id;
    const partner = email('partner');
    await call(owner, `/api/accounts/${account.id}/invites`, { method: 'POST', body: JSON.stringify({ email: partner }) });
    await me(partner);
    await addKit(wid, partner, 'PARTNER');

    const res = await del(partner);
    expect(res.status).toBe(200);
    expect(res.body.leftAccounts).toEqual([account.name]);

    const rows = (await call<SyncResponse>(owner, `/api/w/${wid}/sync`)).body.rows;
    const kit = rows.kits.find((k) => k.code === 'PARTNER')!;
    expect(kit.updated_by).toBe('deleted user'); // the kit stays, the email doesn't
    const history = await call<{ changes: { changed_by: string }[] }>(owner, `/api/w/${wid}/history/kits/${kit.id}`);
    expect(history.body.changes.every((c) => c.changed_by === 'deleted user')).toBe(true);
    const members = await call<{ members: { email: string }[] }>(owner, `/api/accounts/${account.id}/members`);
    expect(members.body.members.map((m) => m.email)).toEqual([owner]);
  });

  it("won't orphan a shared account whose only owner is leaving", async () => {
    const owner = email('sole-owner');
    const account = (await me(owner)).accounts[0];
    const member = email('member');
    await call(owner, `/api/accounts/${account.id}/invites`, { method: 'POST', body: JSON.stringify({ email: member }) });
    await me(member);
    const res = await del(owner);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/only owner/);
    expect((await me(owner)).accounts[0].id).toBe(account.id);
  });
});
