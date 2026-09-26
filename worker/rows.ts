import { TABLE_NAMES, type Rows, type SyncResponse, type TableName } from '../shared/schema';

export async function currentVersion(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT value FROM sync_counter WHERE id = 1').first<{ value: number }>();
  return row?.value ?? 0;
}

/** All rows with version > since. A full pull (since = 0) skips tombstones. */
export async function readChanges(db: D1Database, since: number): Promise<SyncResponse> {
  // Read the counter first: rows written after this point come again next sync, never get skipped.
  const version = await currentVersion(db);
  const full = since <= 0;
  const results = await db.batch(
    TABLE_NAMES.map((t) =>
      full
        ? db.prepare(`SELECT * FROM ${t} WHERE deleted_at IS NULL`)
        : db.prepare(`SELECT * FROM ${t} WHERE version > ?`).bind(since),
    ),
  );
  const rows = {} as { [T in TableName]: Rows[T][] };
  TABLE_NAMES.forEach((t, i) => {
    (rows as Record<string, unknown[]>)[t] = results[i].results;
  });
  return { version, full, rows };
}
