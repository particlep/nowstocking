// Cloudflare Turnstile: server-side check of the token the sign-in form sends.
// On when TURNSTILE_SITEKEY is set; then TURNSTILE_SECRET and TURNSTILE_HOSTNAMES are required.

export function turnstileSitekey(env: Env): string | null {
  const key = (env as { TURNSTILE_SITEKEY?: string }).TURNSTILE_SITEKEY;
  return key ? key : null;
}

/**
 * True only when siteverify says the token is valid, for this action, from an approved hostname.
 * Any error (network, bad response, missing config) fails closed.
 */
export async function verifyTurnstile(env: Env, token: unknown, action: string, ip: string | undefined): Promise<boolean> {
  const secret = (env as { TURNSTILE_SECRET?: string }).TURNSTILE_SECRET;
  const hostnames = new Set(
    String((env as { TURNSTILE_HOSTNAMES?: string }).TURNSTILE_HOSTNAMES ?? '')
      .split(',').map((h) => h.trim()).filter(Boolean),
  );
  if (!secret || hostnames.size === 0) return false;
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return false;
    const result = (await r.json()) as { success?: boolean; action?: string; hostname?: string };
    return result.success === true && result.action === action && hostnames.has(result.hostname ?? '');
  } catch {
    return false;
  }
}
