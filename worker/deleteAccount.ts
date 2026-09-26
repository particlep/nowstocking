// Delete a user and everything that belongs only to them.

export class DeleteBlocked extends Error {}

export interface DeleteSummary {
  deletedAccounts: string[];
  leftAccounts: string[];
  warehousesErased: number;
  photosDeleted: number;
}

async function deletePrefix(bucket: R2Bucket, prefix: string): Promise<number> {
  let deleted = 0;
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    if (page.objects.length) {
      await bucket.delete(page.objects.map((o) => o.key));
      deleted += page.objects.length;
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return deleted;
}

/**
 * - Accounts where the user is the only member are deleted outright: every warehouse's data (Durable Object),
 *   its photos (R2), invites, usage, and the account.
 * - Shared accounts keep going: the user's membership is removed and their email is replaced in each
 *   warehouse's history. If they're the only owner of a shared account, deletion stops until they hand it over.
 * - Finally their sessions, sign-in codes, pending invites and user record are removed.
 */
export async function deleteUser(env: Env, email: string): Promise<DeleteSummary> {
  const db = env.DB;
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
  const summary: DeleteSummary = { deletedAccounts: [], leftAccounts: [], warehousesErased: 0, photosDeleted: 0 };
  if (!user) return summary;

  const { results: memberships } = await db.prepare(
    `SELECT a.id, a.name, m.role,
            (SELECT COUNT(*) FROM memberships x WHERE x.account_id = a.id) AS members,
            (SELECT COUNT(*) FROM memberships x WHERE x.account_id = a.id AND x.role = 'owner') AS owners
     FROM memberships m JOIN accounts a ON a.id = m.account_id WHERE m.user_id = ?`,
  ).bind(user.id).all<{ id: string; name: string; role: string; members: number; owners: number }>();

  const blocked = memberships.filter((m) => m.members > 1 && m.role === 'owner' && m.owners === 1);
  if (blocked.length) {
    throw new DeleteBlocked(
      `You're the only owner of ${blocked.map((b) => b.name).join(', ')}, which other people use. ` +
      'Make someone else an owner in Members first, or remove the other members.',
    );
  }

  const warehouse = (id: string) => env.WAREHOUSE.get(env.WAREHOUSE.idFromName(id));
  const warehousesOf = async (accountId: string) =>
    (await db.prepare('SELECT id FROM warehouses WHERE account_id = ?').bind(accountId).all<{ id: string }>()).results.map((w) => w.id);

  for (const m of memberships) {
    const wids = await warehousesOf(m.id);
    if (m.members === 1) {
      for (const wid of wids) {
        await warehouse(wid).destroy();
        summary.photosDeleted += await deletePrefix(env.IMPORTS, `w/${wid}/`);
        summary.warehousesErased++;
      }
      await db.batch([
        db.prepare('DELETE FROM invites WHERE account_id = ?').bind(m.id),
        db.prepare('DELETE FROM usage WHERE account_id = ?').bind(m.id),
        // AI spend stays counted in monthly totals, but no longer points at the account.
        db.prepare(`UPDATE ai_usage SET account_id = 'deleted', warehouse_id = 'deleted' WHERE account_id = ?`).bind(m.id),
        db.prepare('DELETE FROM warehouses WHERE account_id = ?').bind(m.id),
        db.prepare('DELETE FROM memberships WHERE account_id = ?').bind(m.id),
        db.prepare('DELETE FROM accounts WHERE id = ?').bind(m.id),
      ]);
      summary.deletedAccounts.push(m.name);
    } else {
      for (const wid of wids) await warehouse(wid).anonymize(email);
      await db.batch([
        db.prepare('DELETE FROM memberships WHERE account_id = ? AND user_id = ?').bind(m.id, user.id),
        db.prepare('UPDATE invites SET invited_by = ? WHERE account_id = ? AND invited_by = ?').bind('deleted user', m.id, email),
      ]);
      summary.leftAccounts.push(m.name);
    }
  }

  await db.batch([
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM login_codes WHERE email = ?').bind(email),
    db.prepare('DELETE FROM invites WHERE email = ?').bind(email),
    db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
  ]);
  return summary;
}
