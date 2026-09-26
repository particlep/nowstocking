// Email one-time-code sign-in, for installs without Cloudflare Access (AUTH_MODE = "email").

const CODE_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const SESSION_DAYS = 90; // long, so the app keeps working offline between sign-ins
export const SESSION_COOKIE = 'ns_session';
export const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;

export class AuthError extends Error {
  constructor(message: string, readonly status: 400 | 429 | 500 = 400) {
    super(message);
  }
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(value)));
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

function sameString(a: string, b: string) {
  const x = enc.encode(a);
  const y = enc.encode(b);
  return x.byteLength === y.byteLength && crypto.subtle.timingSafeEqual(x, y);
}

function secret(env: Env) {
  const s = (env as { AUTH_SECRET?: string }).AUTH_SECRET;
  if (!s || s.length < 32) throw new AuthError('AUTH_SECRET is not set on the Worker (32+ characters).', 500);
  return s;
}

function newCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return String(n).padStart(6, '0');
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Email a sign-in code. Returns the code only when EXPOSE_LOGIN_CODES is set (tests). */
export async function startLogin(env: Env, rawEmail: string): Promise<{ code?: string }> {
  const email = rawEmail.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new AuthError('Enter a valid email address.');
  const key = secret(env);
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_codes WHERE email = ? AND created_at > ?')
    .bind(email, hourAgo).first<{ n: number }>();
  if ((recent?.n ?? 0) >= MAX_CODES_PER_HOUR) throw new AuthError('Too many codes requested. Try again in an hour.', 429);

  const code = newCode();
  await env.DB.prepare('INSERT INTO login_codes (email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(email, await hmac(key, `${email}:${code}`), new Date().toISOString(), minutesFromNow(CODE_TTL_MINUTES)).run();

  if ((env as { EXPOSE_LOGIN_CODES?: string }).EXPOSE_LOGIN_CODES === 'true') return { code };
  await env.EMAIL.send({
    to: email,
    from: { email: env.EMAIL_FROM, name: 'NowStocking' },
    subject: `Your NowStocking sign-in code: ${code}`,
    text: `Your sign-in code is ${code}\n\nIt expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<p style="margin:0 0 12px">Your sign-in code is</p><p style="font:700 32px/1 monospace;letter-spacing:4px;margin:0 0 16px">${code}</p><p style="margin:0;color:#5e6673">It expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for it, you can ignore this email.</p>`,
  });
  return {};
}

/** Check a code and start a session. Returns the session token for the cookie. */
export async function verifyLogin(env: Env, rawEmail: string, rawCode: string): Promise<{ token: string; email: string }> {
  const email = rawEmail.trim().toLowerCase();
  const code = rawCode.replace(/\D/g, '');
  const key = secret(env);
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    'SELECT id, code_hash, attempts FROM login_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1',
  ).bind(email, now).first<{ id: number; code_hash: string; attempts: number }>();
  if (!row) throw new AuthError('That code has expired. Ask for a new one.');
  if (row.attempts >= MAX_ATTEMPTS) throw new AuthError('Too many wrong tries. Ask for a new code.', 429);
  if (code.length !== 6 || !sameString(await hmac(key, `${email}:${code}`), row.code_hash)) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    throw new AuthError("That code isn't right.");
  }

  const token = newToken();
  const userRow = await env.DB
    .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET email = email RETURNING id')
    .bind(crypto.randomUUID(), email, now).first<{ id: string }>();
  await env.DB.batch([
    env.DB.prepare('UPDATE login_codes SET used_at = ? WHERE id = ?').bind(now, row.id),
    env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await sha256(token), userRow!.id, now, minutesFromNow(SESSION_DAYS * 1440), now),
  ]);
  return { token, email };
}

/** The signed-in email for a session token, or null. Extends the session at most once a day. */
export async function sessionEmail(env: Env, token: string): Promise<string | null> {
  const hash = await sha256(token);
  const now = new Date();
  const row = await env.DB.prepare(
    'SELECT u.email, s.expires_at, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
  ).bind(hash).first<{ email: string; expires_at: string; last_seen_at: string }>();
  if (!row || row.expires_at <= now.toISOString()) return null;
  if (now.getTime() - Date.parse(row.last_seen_at) > 86_400_000) {
    await env.DB.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .bind(now.toISOString(), minutesFromNow(SESSION_DAYS * 1440), hash).run();
  }
  return row.email;
}

export async function endSession(env: Env, token: string) {
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;
