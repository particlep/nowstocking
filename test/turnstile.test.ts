import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import app from '../worker/index';

const BASE = 'https://app.nowstocking.com';
const WITH_TURNSTILE = {
  ...env, AUTH_MODE: 'email', SIGNUP_MODE: 'open', AUTH_SECRET: 'test-secret-that-is-long-enough-1234567890',
  EXPOSE_LOGIN_CODES: 'true', TURNSTILE_SITEKEY: 'test-sitekey', TURNSTILE_SECRET: 'test-secret', TURNSTILE_HOSTNAMES: 'app.nowstocking.com',
} as unknown as Env;

/** Stand-in for Cloudflare's siteverify: the token says what it should answer. */
function mockSiteverify() {
  const real = globalThis.fetch;
  const calls: URLSearchParams[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://challenges.cloudflare.com/turnstile/v0/siteverify')) return real(input, init);
    const form = new URLSearchParams(String(init?.body));
    calls.push(form);
    const token = form.get('response');
    if (token === 'unreachable') throw new TypeError('network down');
    const answers: Record<string, object> = {
      good: { success: true, action: 'signin', hostname: 'app.nowstocking.com' },
      failed: { success: false, 'error-codes': ['invalid-input-response'] },
      'other-action': { success: true, action: 'signup', hostname: 'app.nowstocking.com' },
      'other-host': { success: true, action: 'signin', hostname: 'evil.example' },
      localhost: { success: true, action: 'signin', hostname: 'localhost' },
    };
    return Response.json(answers[token ?? ''] ?? { success: false });
  });
  return calls;
}

let n = 0;
async function start(turnstile?: string) {
  const res = await app.fetch(new Request(`${BASE}/api/auth/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'CF-Connecting-IP': `198.51.100.${++n}` },
    body: JSON.stringify({ email: `bot-check-${n}@example.com`, turnstile }),
  }), WITH_TURNSTILE);
  return res.status;
}

afterEach(() => vi.restoreAllMocks());

describe('Turnstile on email sign-in', () => {
  it('tells the app the sitekey', async () => {
    const res = await app.fetch(new Request(`${BASE}/api/auth/config`), WITH_TURNSTILE);
    expect(await res.json()).toEqual({ mode: 'email', turnstileSitekey: 'test-sitekey' });
  });

  it('sends a code only when the check passes, for this action and hostname', async () => {
    const calls = mockSiteverify();
    expect(await start('good')).toBe(200);
    expect(calls[0].get('secret')).toBe('test-secret');
    expect(calls[0].get('remoteip')).toMatch(/^198\.51\.100\./);

    expect(await start(undefined)).toBe(403);
    expect(await start('failed')).toBe(403);
    expect(await start('other-action')).toBe(403);
    expect(await start('other-host')).toBe(403);
    expect(await start('localhost')).toBe(403); // local test hostnames are never accepted in production
  });

  it('fails closed when siteverify is unreachable', async () => {
    mockSiteverify();
    expect(await start('unreachable')).toBe(403);
  });

  it('stays off when no sitekey is configured', async () => {
    const off = { ...WITH_TURNSTILE, TURNSTILE_SITEKEY: '' } as unknown as Env;
    const res = await app.fetch(new Request(`${BASE}/api/auth/start`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'CF-Connecting-IP': '192.0.2.1' },
      body: JSON.stringify({ email: 'no-bot-check@example.com' }),
    }), off);
    expect(res.status).toBe(200);
  });
});
