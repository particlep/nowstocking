// Accepting the terms (email sign-in, the hosted service). TERMS_UPDATED_AT is when they last changed; anyone who
// accepted before then (or never) must accept again before using a warehouse.
import { authMode } from './auth';

export function termsUpdatedAt(env: Env): string {
  return String((env as { TERMS_UPDATED_AT?: string }).TERMS_UPDATED_AT ?? '').trim();
}

/** True when this user has to accept the current terms. */
export function termsRequired(env: Env, acceptedAt: string | null | undefined): boolean {
  const updated = termsUpdatedAt(env);
  if (authMode(env) !== 'email' || !updated) return false;
  return !acceptedAt || acceptedAt < updated;
}
