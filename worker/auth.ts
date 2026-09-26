import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { MiddlewareHandler } from 'hono';

export type AppEnv = { Bindings: Env; Variables: { user: string } };

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let jwksDomain = '';

/**
 * Validates the Cloudflare Access JWT on every /api request.
 * Local dev only: when ACCESS_AUD is unset and DEV_USER_EMAIL is set (from .dev.vars),
 * requests run as that user. Deployed without ACCESS_AUD, every request is refused.
 */
export const requireAccess: MiddlewareHandler<AppEnv> = async (c, next) => {
  // Vars are typed as their literal config values; they're plain strings at runtime.
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD } = c.env as unknown as { ACCESS_TEAM_DOMAIN: string; ACCESS_AUD: string };
  const devUser = (c.env as { DEV_USER_EMAIL?: string }).DEV_USER_EMAIL;

  if (!ACCESS_AUD || !ACCESS_TEAM_DOMAIN) {
    if (devUser) {
      c.set('user', devUser);
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
    c.set('user', email.toLowerCase());
  } catch {
    return c.json({ error: 'invalid token' }, 401);
  }
  return next();
};
