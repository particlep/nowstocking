export class SignInRequired extends Error {}

/**
 * Fetch an API route. When the Access session has expired, Access answers with a redirect
 * to its login page instead of JSON. Detect that and ask for sign-in; never drop the outbox.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, redirect: 'manual', credentials: 'same-origin' });
  if (res.type === 'opaqueredirect' || res.status === 401) throw new SignInRequired();
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) {
    if (type.includes('text/html')) throw new SignInRequired();
    throw new Error(`Unexpected response ${res.status}`);
  }
  const body = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}
