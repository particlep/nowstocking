import { DurableObject } from 'cloudflare:workers';
import type { ImportJob, ImportJobSummary, ImportKind, ImportPageInfo, ParsedInstructions, ParsedPage } from '../../shared/importTypes';
import { buildCatalog, buildCsv } from '../../shared/inventory';
import { TABLE_NAMES, type Mutation, type MutationsResponse, type Rows, type SyncResponse, type TableName } from '../../shared/schema';
import { applyMutations } from './mutations';
import { migrate } from './schema';

/** Errors that carry an HTTP status across the RPC boundary as "404: message". */
export function httpError(status: 400 | 404 | 409, message: string) {
  return new Error(`${status}: ${message}`);
}

export interface HistoryEntry {
  table_name: string; field: string; old_value: string | null; new_value: string | null; changed_by: string; changed_at: string;
}

/**
 * One warehouse: its whole inventory, sync counter, change log and photo-import jobs, in its own SQLite
 * database. Nothing in here knows about accounts or other warehouses; the Worker decides who may call it.
 */
export class Warehouse extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => migrate(this.sql));
  }

  private version(): number {
    return this.sql.exec('SELECT value FROM sync_counter WHERE id = 1').one().value as number;
  }

  // ---- Sync ----

  /** All rows with version > since. A full pull (since = 0) skips tombstones. */
  sync(since: number): SyncResponse {
    const version = this.version();
    const full = since <= 0;
    const rows = {} as { [T in TableName]: Rows[T][] };
    for (const t of TABLE_NAMES) {
      const cursor = full
        ? this.sql.exec(`SELECT * FROM ${t} WHERE deleted_at IS NULL`)
        : this.sql.exec(`SELECT * FROM ${t} WHERE version > ?`, since);
      (rows as Record<string, unknown[]>)[t] = cursor.toArray();
    }
    return { version, full, rows };
  }

  mutate(user: string, mutations: Mutation[]): MutationsResponse {
    const results = applyMutations(this.ctx.storage, user, mutations);
    return { results, version: this.version() };
  }

  /** An item's history includes its placements (moves) and consumptions. */
  history(table: TableName, id: number): HistoryEntry[] {
    return this.sql.exec(
      `SELECT table_name, field, old_value, new_value, changed_by, changed_at FROM change_log
       WHERE (table_name = ?1 AND row_id = ?2)
          OR (?1 = 'items' AND table_name = 'placements' AND row_id IN (SELECT id FROM placements WHERE item_id = ?2))
          OR (?1 = 'items' AND table_name = 'consumptions' AND row_id IN (SELECT id FROM consumptions WHERE item_id = ?2))
       ORDER BY id DESC LIMIT 200`,
      table, id,
    ).toArray() as unknown as HistoryEntry[];
  }

  exportCsv(): string {
    return buildCsv(buildCatalog(this.sync(0).rows));
  }

  // ---- Photo imports ----

  createJob(user: string, pageCount: number, kind: ImportKind, title: string | null): string {
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 40) throw httpError(400, 'page_count must be 1-40');
    if (kind !== 'packing_list' && kind !== 'instructions') throw httpError(400, 'unknown kind');
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT INTO import_jobs (id, kind, title, status, page_count, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, kind, title?.trim().slice(0, 200) || null, 'uploading', pageCount, user, now, now,
      );
      for (let p = 1; p <= pageCount; p++) {
        this.sql.exec(`INSERT INTO import_pages (job_id, page, status, updated_at) VALUES (?, ?, 'waiting', ?)`, id, p, now);
      }
    });
    return id;
  }

  listJobs(kind: ImportKind): ImportJobSummary[] {
    return this.sql.exec(
      `SELECT j.id, j.kind, j.title, j.status, j.page_count, j.created_at,
              SUM(p.status = 'done') AS pages_done, SUM(p.status = 'failed') AS pages_failed,
              (SELECT json_extract(p2.result, '$.kit_name') FROM import_pages p2
                WHERE p2.job_id = j.id AND json_extract(p2.result, '$.kit_name') IS NOT NULL ORDER BY p2.page LIMIT 1) AS kit_name,
              (SELECT json_extract(p3.result, '$.page_label') FROM import_pages p3
                WHERE p3.job_id = j.id AND json_extract(p3.result, '$.page_label') IS NOT NULL ORDER BY p3.page LIMIT 1) AS page_label
       FROM import_jobs j JOIN import_pages p ON p.job_id = j.id
       WHERE j.kind = ? GROUP BY j.id ORDER BY j.created_at DESC LIMIT 50`,
      kind,
    ).toArray() as unknown as ImportJobSummary[];
  }

  getJob(jobId: string): ImportJob {
    const job = this.sql.exec('SELECT * FROM import_jobs WHERE id = ?', jobId).toArray()[0] as Omit<ImportJob, 'pages'> | undefined;
    if (!job) throw httpError(404, 'no such import');
    const pages = this.sql.exec(
      'SELECT page, status, image_key, error, result, updated_at FROM import_pages WHERE job_id = ? ORDER BY page', jobId,
    ).toArray() as unknown as (Omit<ImportPageInfo, 'result'> & { result: string | null })[];
    return { ...job, pages: pages.map((p) => ({ ...p, result: p.result ? (JSON.parse(p.result) as ParsedPage | ParsedInstructions) : null })) };
  }

  /** Checks a page can take a photo. Returns where to store it. */
  pageUploadKey(warehouseId: string, jobId: string, page: number, ext: string): string {
    const row = this.sql.exec('SELECT status FROM import_pages WHERE job_id = ? AND page = ?', jobId, page).toArray()[0];
    if (!row) throw httpError(404, 'no such page');
    if (row.status === 'reading' || row.status === 'done') throw httpError(409, 'page already read');
    return `w/${warehouseId}/imports/${jobId}/page-${String(page).padStart(2, '0')}.${ext}`;
  }

  pageUploaded(jobId: string, page: number, key: string) {
    this.sql.exec(
      `UPDATE import_pages SET image_key = ?, status = 'uploaded', error = NULL, updated_at = ? WHERE job_id = ? AND page = ?`,
      key, new Date().toISOString(), jobId, page,
    );
  }

  /** Marks pages as reading and returns them. The Worker then starts the Workflow. */
  startReading(jobId: string, pages?: number[]): number[] {
    const rows = this.sql.exec('SELECT page, status FROM import_pages WHERE job_id = ?', jobId).toArray() as { page: number; status: string }[];
    if (!rows.length) throw httpError(404, 'no such import');
    const want = pages?.length ? pages : rows.filter((r) => r.status === 'uploaded').map((r) => r.page);
    const missing = rows.find((r) => want.includes(r.page) && r.status === 'waiting');
    if (missing) throw httpError(409, `page ${missing.page} has no photo yet`);
    if (!want.length) throw httpError(409, 'nothing to read');
    const now = new Date().toISOString();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(`UPDATE import_jobs SET status = 'processing', updated_at = ? WHERE id = ?`, now, jobId);
      for (const p of want) {
        this.sql.exec(`UPDATE import_pages SET status = 'reading', error = NULL, updated_at = ? WHERE job_id = ? AND page = ?`, now, jobId, p);
      }
    });
    return want;
  }

  /** Undo startReading when the Workflow couldn't be started, so pages don't stay stuck on "reading". */
  cancelReading(jobId: string, pages: number[]) {
    for (const p of pages) {
      this.sql.exec(`UPDATE import_pages SET status = 'uploaded', updated_at = ? WHERE job_id = ? AND page = ?`, new Date().toISOString(), jobId, p);
    }
  }

  /** For the Workflow: what to read. */
  pageToRead(jobId: string, page: number): { imageKey: string; kind: ImportKind } | null {
    const row = this.sql.exec(
      'SELECT p.image_key, j.kind FROM import_pages p JOIN import_jobs j ON j.id = p.job_id WHERE p.job_id = ? AND p.page = ?', jobId, page,
    ).toArray()[0] as { image_key: string | null; kind: ImportKind } | undefined;
    return row?.image_key ? { imageKey: row.image_key, kind: row.kind } : null;
  }

  pageDone(jobId: string, page: number, result: ParsedPage | ParsedInstructions) {
    this.sql.exec(
      `UPDATE import_pages SET status = 'done', result = ?, error = NULL, updated_at = ? WHERE job_id = ? AND page = ?`,
      JSON.stringify(result), new Date().toISOString(), jobId, page,
    );
  }

  pageFailed(jobId: string, page: number, error: string) {
    this.sql.exec(
      `UPDATE import_pages SET status = 'failed', error = ?, updated_at = ? WHERE job_id = ? AND page = ?`,
      error.slice(0, 500), new Date().toISOString(), jobId, page,
    );
  }

  finishJobIfDone(jobId: string) {
    this.sql.exec(
      `UPDATE import_jobs SET status = 'done', updated_at = ?
       WHERE id = ? AND status = 'processing' AND NOT EXISTS (SELECT 1 FROM import_pages WHERE job_id = ? AND status = 'reading')`,
      new Date().toISOString(), jobId, jobId,
    );
  }

  markCommitted(jobId: string) {
    this.sql.exec(`UPDATE import_jobs SET status = 'committed', updated_at = ? WHERE id = ?`, new Date().toISOString(), jobId);
  }

  deleteJob(jobId: string) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM import_pages WHERE job_id = ?', jobId);
      this.sql.exec('DELETE FROM import_jobs WHERE id = ?', jobId);
    });
  }
}
