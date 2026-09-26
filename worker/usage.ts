// Monthly photo-read limits per account. PHOTO_PAGES_PER_MONTH = 0 means unlimited (self-hosted default).

export interface Usage { month: string; photo_pages: number; limit: number }

const thisMonth = () => new Date().toISOString().slice(0, 7);

export function photoLimit(env: Env): number {
  const n = Number((env as { PHOTO_PAGES_PER_MONTH?: string }).PHOTO_PAGES_PER_MONTH ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export async function getUsage(env: Env, accountId: string): Promise<Usage> {
  const month = thisMonth();
  const row = await env.DB.prepare('SELECT photo_pages FROM usage WHERE account_id = ? AND month = ?').bind(accountId, month).first<{ photo_pages: number }>();
  return { month, photo_pages: row?.photo_pages ?? 0, limit: photoLimit(env) };
}

/** Count pages about to be read. Throws if that would go over the monthly limit. */
export async function recordPhotoPages(env: Env, accountId: string, pages: number) {
  const limit = photoLimit(env);
  const month = thisMonth();
  if (limit) {
    const { photo_pages } = await getUsage(env, accountId);
    if (photo_pages + pages > limit) {
      throw new Error(`409: This account has read ${photo_pages} of ${limit} photo pages this month. The limit resets on the 1st.`);
    }
  }
  await env.DB.prepare(
    `INSERT INTO usage (account_id, month, photo_pages) VALUES (?, ?, ?)
     ON CONFLICT(account_id, month) DO UPDATE SET photo_pages = photo_pages + excluded.photo_pages`,
  ).bind(accountId, month, pages).run();
}
