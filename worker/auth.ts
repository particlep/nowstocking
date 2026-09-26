import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { SESSION_COOKIE, sessionEmail } from './session';
import type { Role } from '../shared/directory';
import type { Warehouse } from './warehouse/Warehouse';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    email: string;
    warehouse: { id: string; role: Role; accountId: string; stub: DurableObjectStub<Warehouse> };
  };
};

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksDomain = '';

export function authMode(env: Env): 'access' | 'email' {
  return (env.AUTH_MODE as string) === 'email' ? 'email' : 'access';
}

/** Routes anyone can call: starting and finishing a sign-in. */
const PUBLIC = /^\/api\/auth\/(config|start|verify)$/;

/**
 * Who is calling.
 * - AUTH_MODE "email": a session cookie from a one-time-code sign-in. Writes must come from this site.
 * - AUTH_MODE "access": self-hosted installs sit behind Cloudflare Access, and the Worker verifies the Access JWT on
 * every /api request. Local dev and tests only: when ACCESS_AUD is unset and DEV_USER_EMAIL is set,
 * requests run as that user (or as X-Dev-User, for multi-user tests). Deployed without either, every request is refused.
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (PUBLIC.test(c.req.path)) return next();

  if (authMode(c.env) === 'email') {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('Origin');
      if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: 'cross-site request' }, 403);
    }
    const token = getCookie(c, SESSION_COOKIE);
    const email = token ? await sessionEmail(c.env, token) : null;
    if (!email) return c.json({ error: 'unauthenticated', auth: 'email' }, 401);
    c.set('email', email);
    return next();
  }

  // Vars are typed as their literal config values; they're plain strings at runtime.
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = c.env as unknown as { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string };
  const devUser = (c.env as { DEV_USER_EMAIL?: string }).DEV_USER_EMAIL;

  if (!ACCESS_AUD || !ACCESS_TEAM_DOMAIN) {
    if (devUser) {
      c.set('email', (c.req.header('X-Dev-User') || devUser).toLowerCase());
      return next();
    }
    return c.json({ error: 'Access is not configured' }, 500);
  }

  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return c.json({ error: 'unauthenticated' }, 401);

  const issuer = ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
  if (!jwks || jwksDomain !== issuer) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksDomain = issuer;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: ACCESS_AUD });
    const email = typeof payload.email === 'string' ? payload.email : null;
    if (!email) return c.json({ error: 'no email in token' }, 401);
    c.set('email', email.toLowerCase());
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }
  return next();
};
