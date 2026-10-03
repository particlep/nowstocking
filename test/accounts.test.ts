import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../shared/directory';
import app from '../worker/index';

const BASE = 'https://parts.example.com';
const EMAIL_MODE = {
  ...env, AUTH_MODE: 'email', SIGNUP_MODE: 'open', AUTH_SECRET: 'test-secret-that-is-long-enough-1234567890', EXPOSE_LOGIN_CODES: 'true',
} as unknown as Env;
const OPEN = { ...env, SIGNUP_MODE: 'open', EXPOSE_LOGIN_CODES: 'true' } as unknown as Env;
const SIGNUP = { name: 'Test Builder', terms: true };

let seq = 0;
const email = (name: string) => `${name}-${++seq}@example.com`;

async function req(e: Env, path: string, init: RequestInit & { cookie?: string; user?: string; ip?: string } = {}) {
  const headers = new Headers(init.headers);
  // Each request from its own address unless a test says otherwise, so the per-IP limit doesn't interfere.
  headers.set('CF-Connecting-IP', init.ip ?? `10.0.${++seq % 250}.${seq % 250}`);
  if (init.cookie) headers.set('Cookie', init.cookie);
  if (init.user) headers.set('X-Dev-User', init.user);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await app.fetch(new Request(BASE + path, { ...init, headers }), e);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function signIn(address: string) {
  const start = await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address, signup: SIGNUP }) });
  expect(start.res.status).toBe(200);
  const verify = await req(EMAIL_MODE, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: address, code: start.body.code }) });
  expect(verify.res.status).toBe(200);
  const setCookie = verify.res.headers.get('set-cookie') ?? '';
  expect(setCookie).toMatch(/ns_session=.+; .*HttpOnly/i);
  return setCookie.split(';')[0];
}

describe('email sign-in', () => {
  it('signs in with a code and gets an account', async () => {
    const address = email('pilot');
    const cookie = await signIn(address);
    const me = await req(EMAIL_MODE, '/api/me', { cookie });
    expect(me.res.status).toBe(200);
    const body = me.body as unknown as MeResponse;
    expect(body.user.email).toBe(address);
    expect(body.accounts[0].role).toBe('owner');
  });

  it('signs up with a name and accepted terms, then signs in again without them', async () => {
    const address = email('newbie');
    await signIn(address);
    const user = await env.DB.prepare('SELECT name, terms_accepted_at FROM users WHERE email = ?').bind(address).first<{ name: string; terms_accepted_at: string }>();
    expect(user?.name).toBe('Test Builder');
    expect(user?.terms_accepted_at).toBeTruthy();
    const again = await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address }) });
    expect(again.body.code).toMatch(/^\d{6}$/);
  });

  it("refuses to sign up without a name or without agreeing to the terms", async () => {
    const start = (signup: unknown) => req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: email('half'), signup }) });
    expect((await start({ name: 'Pat', terms: false })).res.status).toBe(400);
    expect((await start({ name: '  ', terms: true })).res.status).toBe(400);
  });

  it("answers a sign-in for an unknown email the same way, without sending a code", async () => {
    const address = email('stranger');
    const { res, body } = await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address }) });
    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    const codes = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ?').bind(address).first<{ n: number }>();
    expect(codes?.n).toBe(0);
  });

  it('tells the app to show its sign-in screen when there is no session', async () => {
    const { res, body } = await req(EMAIL_MODE, '/api/me');
    expect(res.status).toBe(401);
    expect(body.auth).toBe('email');
    expect((await req(EMAIL_MODE, '/api/auth/config')).body.mode).toBe('email');
  });

  it('rejects wrong codes, then locks the code after five tries', async () => {
    const address = email('guess');
    const { body } = await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address, signup: SIGNUP }) });
    const wrong = String((Number(body.code) + 1) % 1_000_000).padStart(6, '0');
    for (let i = 0; i < 5; i++) {
      const r = await req(EMAIL_MODE, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: address, code: wrong }) });
      expect(r.res.status).toBe(400);
    }
    const locked = await req(EMAIL_MODE, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: address, code: body.code }) });
    expect(locked.res.status).toBe(429);
  });

  it('still accepts an earlier code after a new one is sent', async () => {
    const address = email('twice');
    const first = await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address, signup: SIGNUP }) });
    await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address, signup: SIGNUP }) });
    const verify = await req(EMAIL_MODE, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: address, code: first.body.code }) });
    expect(verify.res.status).toBe(200);
  });

  it("doesn't give extra guesses for asking for more codes", async () => {
    const address = email('more-guesses');
    const codes: string[] = [];
    for (let i = 0; i < 3; i++) {
      codes.push(String((await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address, signup: SIGNUP }) })).body.code));
    }
    let wrong = 0;
    for (let n = 0; wrong < 5; n++) {
      const guess = String(n).padStart(6, '0');
      if (codes.includes(guess)) continue;
      expect((await req(EMAIL_MODE, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: address, code: guess }) })).res.status).toBe(400);
      wrong++;
    }
    const locked = await req(EMAIL_MODE, '/api/auth/verify', { method: 'POST', body: JSON.stringify({ email: address, code: codes[2] }) });
    expect(locked.res.status).toBe(429);
  });

  it('limits how many codes one address can request', async () => {
    const address = email('spam');
    for (let i = 0; i < 5; i++) {
      expect((await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address, signup: SIGNUP }) })).res.status).toBe(200);
    }
    expect((await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: address, signup: SIGNUP }) })).res.status).toBe(429);
  });

  it('ends the session on sign-out', async () => {
    const cookie = await signIn(email('bye'));
    expect((await req(EMAIL_MODE, '/api/auth/logout', { method: 'POST', cookie })).res.status).toBe(200);
    expect((await req(EMAIL_MODE, '/api/me', { cookie })).res.status).toBe(401);
  });

  it('refuses writes from another site', async () => {
    const cookie = await signIn(email('csrf'));
    const me = (await req(EMAIL_MODE, '/api/me', { cookie })).body as unknown as MeResponse;
    const { res } = await req(EMAIL_MODE, `/api/accounts/${me.accounts[0].id}/invites`, {
      method: 'POST', cookie, headers: { Origin: 'https://evil.example' }, body: JSON.stringify({ email: 'x@example.com' }),
    });
    expect(res.status).toBe(403);
  });

  it('limits sign-in requests per IP address', async () => {
    const ip = '203.0.113.9';
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await req(EMAIL_MODE, '/api/auth/start', { method: 'POST', ip, body: JSON.stringify({ email: email('flood') }) })).res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('is off for installs that use Access', async () => {
    expect((await req(env, '/api/auth/start', { method: 'POST', body: JSON.stringify({ email: 'a@example.com' }) })).res.status).toBe(400);
  });
});

describe('members and invites', () => {
  async function owner() {
    const user = email('owner');
    const me = (await req(OPEN, '/api/me', { user })).body as unknown as MeResponse;
    return { user, accountId: me.accounts[0].id, wid: me.accounts[0].warehouses[0].id };
  }

  it('joins the inviting account on sign-in, with the invited role, instead of making a new one', async () => {
    const o = await owner();
    const invitee = email('partner');
    expect((await req(OPEN, `/api/accounts/${o.accountId}/invites`, { method: 'POST', user: o.user, body: JSON.stringify({ email: invitee, role: 'admin' }) })).res.status).toBe(200);
    const listed = await req(OPEN, `/api/accounts/${o.accountId}/members`, { user: o.user });
    expect((listed.body.invites as { email: string }[]).map((i) => i.email)).toEqual([invitee]);

    const me = (await req(OPEN, '/api/me', { user: invitee })).body as unknown as MeResponse;
    expect(me.accounts).toHaveLength(1);
    expect(me.accounts[0]).toMatchObject({ id: o.accountId, role: 'admin' });
    expect(me.accounts[0].warehouses.map((w) => w.id)).toEqual([o.wid]);

    const after = await req(OPEN, `/api/accounts/${o.accountId}/members`, { user: o.user });
    expect(after.body.invites).toEqual([]);
    expect((after.body.members as { email: string }[]).map((m) => m.email).sort()).toEqual([invitee, o.user].sort());
  });

  it('enforces roles', async () => {
    const o = await owner();
    const admin = email('admin');
    const member = email('member');
    await req(OPEN, `/api/accounts/${o.accountId}/invites`, { method: 'POST', user: o.user, body: JSON.stringify({ email: admin, role: 'admin' }) });
    await req(OPEN, `/api/accounts/${o.accountId}/invites`, { method: 'POST', user: o.user, body: JSON.stringify({ email: member }) });
    await req(OPEN, '/api/me', { user: admin });
    await req(OPEN, '/api/me', { user: member });
    const ids = Object.fromEntries(((await req(OPEN, `/api/accounts/${o.accountId}/members`, { user: o.user })).body.members as { email: string; user_id: string }[]).map((m) => [m.email, m.user_id]));

    // Members can't invite; admins can't change roles or remove the owner.
    expect((await req(OPEN, `/api/accounts/${o.accountId}/invites`, { method: 'POST', user: member, body: JSON.stringify({ email: email('x') }) })).res.status).toBe(403);
    expect((await req(OPEN, `/api/accounts/${o.accountId}/members/${ids[member]}`, { method: 'PATCH', user: admin, body: JSON.stringify({ role: 'admin' }) })).res.status).toBe(403);
    expect((await req(OPEN, `/api/accounts/${o.accountId}/members/${ids[o.user]}`, { method: 'DELETE', user: admin })).res.status).toBe(403);
    // The last owner can't step down or leave.
    expect((await req(OPEN, `/api/accounts/${o.accountId}/members/${ids[o.user]}`, { method: 'PATCH', user: o.user, body: JSON.stringify({ role: 'member' }) })).res.status).toBe(409);
    expect((await req(OPEN, `/api/accounts/${o.accountId}/members/${ids[o.user]}`, { method: 'DELETE', user: o.user })).res.status).toBe(409);
    // Admins remove members; members can leave; outsiders see nothing.
    expect((await req(OPEN, `/api/accounts/${o.accountId}/members/${ids[member]}`, { method: 'DELETE', user: admin })).res.status).toBe(200);
    expect((await req(OPEN, `/api/w/${o.wid}/sync`, { user: member })).res.status).toBe(404);
    expect((await req(OPEN, `/api/accounts/${o.accountId}/members/${ids[admin]}`, { method: 'DELETE', user: admin })).res.status).toBe(200);
    expect((await req(OPEN, `/api/accounts/${o.accountId}/members`, { user: email('stranger') })).res.status).toBe(404);
  });
});

describe('photo reading limits', () => {
  it('stops at the monthly limit and reports usage', async () => {
    const limited = { ...OPEN, PHOTO_PAGES_PER_MONTH: '1' } as unknown as Env;
    const user = email('limited');
    const me = (await req(limited, '/api/me', { user })).body as unknown as MeResponse;
    const { id: accountId, warehouses: [{ id: wid }] } = me.accounts[0];

    const job = (await req(limited, `/api/w/${wid}/import/jobs`, { method: 'POST', user, body: JSON.stringify({ page_count: 2 }) })).body.id as string;
    for (const page of [1, 2]) {
      const put = await app.fetch(new Request(`${BASE}/api/w/${wid}/import/jobs/${job}/pages/${page}`, {
        method: 'PUT', headers: { 'X-Dev-User': user, 'content-type': 'image/jpeg' }, body: new Uint8Array([1, 2, 3]),
      }), limited);
      expect(put.status).toBe(200);
    }
    const over = await req(limited, `/api/w/${wid}/import/jobs/${job}/start`, { method: 'POST', user, body: '{}' });
    expect(over.res.status).toBe(409);
    expect(String(over.body.error)).toMatch(/of 1 photo pages/);
    // The refused pages are ready to try again, not stuck "reading".
    const after = (await req(limited, `/api/w/${wid}/import/jobs/${job}`, { user })).body as { pages: { status: string }[] };
    expect(after.pages.map((p) => p.status)).toEqual(['uploaded', 'uploaded']);

    const usage = (await req(limited, `/api/accounts/${accountId}/usage`, { user })).body;
    expect(usage).toMatchObject({ photo_pages: 0, limit: 1 });
  });
});

describe('terms updates', () => {
  const UPDATED = { ...EMAIL_MODE, TERMS_UPDATED_AT: '2099-01-01' } as unknown as Env;

  it('asks users who accepted before the terms changed to accept again, and blocks warehouses until they do', async () => {
    const cookie = await signIn(email('returning'));
    const before = (await req(EMAIL_MODE, '/api/me', { cookie })).body as unknown as MeResponse;
    expect(before.terms_required).toBe(false);
    const wid = before.accounts[0].warehouses[0].id;

    const after = (await req(UPDATED, '/api/me', { cookie })).body as unknown as MeResponse;
    expect(after.terms_required).toBe(true);
    const blocked = await req(UPDATED, `/api/w/${wid}/sync?since=0`, { cookie });
    expect(blocked.res.status).toBe(403);
    expect(blocked.body.terms).toBe(true);

    expect((await req(UPDATED, '/api/me/terms', { method: 'POST', cookie, body: JSON.stringify({ accept: false }) })).res.status).toBe(400);
    // Terms that changed in 2020, accepted back in 2019: blocked until accepted again.
    const y2020 = { ...EMAIL_MODE, TERMS_UPDATED_AT: '2020-01-01' } as unknown as Env;
    await env.DB.prepare('UPDATE users SET terms_accepted_at = ? WHERE email = ?').bind('2019-06-01T00:00:00.000Z', before.user.email).run();
    expect((await req(y2020, `/api/w/${wid}/sync?since=0`, { cookie })).res.status).toBe(403);
    expect((await req(y2020, '/api/me/terms', { method: 'POST', cookie, body: JSON.stringify({ accept: true }) })).res.status).toBe(200);
    expect(((await req(y2020, '/api/me', { cookie })).body as unknown as MeResponse).terms_required).toBe(false);
    expect((await req(y2020, `/api/w/${wid}/sync?since=0`, { cookie })).res.status).toBe(200);
  });
});
