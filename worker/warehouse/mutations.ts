// Applies queued client edits to one warehouse. Each mutation is one SQLite transaction, applied at most once.
import { normalizeLocationCode, toSearchKey } from '../../shared/normalize';
import {
  PHOTO_KEY, TABLE_NAMES, WRITABLE,
  type Mutation, type MutationResult, type Op, type TableName,
} from '../../shared/schema';

const MAX_OPS = 5000;
const MAX_MUTATIONS = 200;

type Scalar = string | number | null;

const DEFAULTS: Partial<Record<TableName, Record<string, Scalar>>> = {
  kits: { received_at: null },
  locations: { description: null },
  items: { parent_id: null, description: null, vans_bin: null, status: 'expected', source: 'manual', notes: null, photo_key: null, qty_received: null },
  placements: { qty: null },
  pick_lists: { page: null, title: null },
  pick_list_lines: { qty_needed: null, pulled: 0 },
  consumptions: { pick_list_id: null, note: null },
};

interface Planned {
  table: TableName;
  id: number;
  insert: boolean;
  fields: Record<string, Scalar>;
}

export class Rejection extends Error {}

function cleanValue(v: unknown): Scalar {
  if (v === null || typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  throw new Rejection(`invalid value ${JSON.stringify(v)}`);
}

function cleanFields(table: TableName, fields: unknown): Record<string, Scalar> {
  if (!fields || typeof fields !== 'object') throw new Rejection('fields must be an object');
  const allowed = WRITABLE[table] as readonly string[];
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) throw new Rejection(`${table}.${k} is not writable`);
    out[k] = cleanValue(v);
  }
  if ((table === 'items' || table === 'pick_list_lines') && typeof out.stock_code === 'string') {
    out.stock_code = out.stock_code.trim();
    out.search_key = toSearchKey(out.stock_code);
  }
  if (table === 'locations' && typeof out.code === 'string') out.code = normalizeLocationCode(out.code);
  if (table === 'items' && out.photo_key != null && !PHOTO_KEY.test(String(out.photo_key))) throw new Rejection('invalid photo_key');
  return out;
}

/** Validate ops and fold several ops on the same row into one. Inserts run before updates, in table order. */
function plan(m: Mutation, now: string): Planned[] {
  if (!Array.isArray(m.ops) || m.ops.length === 0) throw new Rejection('no ops');
  if (m.ops.length > MAX_OPS) throw new Rejection('too many ops');
  const byRow = new Map<string, Planned>();
  for (const op of m.ops as Op[]) {
    if (!TABLE_NAMES.includes(op.table)) throw new Rejection(`unknown table ${op.table}`);
    if (!Number.isSafeInteger(op.id) || op.id <= 0) throw new Rejection('invalid id');
    const key = `${op.table}:${op.id}`;
    const existing = byRow.get(key);
    const fields = op.op === 'delete' ? { deleted_at: now } : cleanFields(op.table, op.fields);
    if (op.op === 'insert') {
      if (existing) throw new Rejection(`duplicate insert ${key}`);
      byRow.set(key, { table: op.table, id: op.id, insert: true, fields: { ...DEFAULTS[op.table], ...fields } });
    } else if (op.op === 'update' || op.op === 'delete') {
      if (existing) Object.assign(existing.fields, fields);
      else byRow.set(key, { table: op.table, id: op.id, insert: false, fields });
    } else {
      throw new Rejection('unknown op');
    }
  }
  const rank = (p: Planned) => (p.insert ? 0 : 1) * 100 + TABLE_NAMES.indexOf(p.table);
  // Stable: rows within a table keep their order (a bag before the parts in it).
  return [...byRow.values()].map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

const str = (v: unknown) => (v == null ? null : String(v));

function applyOne(sql: SqlStorage, m: Mutation, planned: Planned[], user: string, now: string) {
  const version = sql.exec('UPDATE sync_counter SET value = value + 1 WHERE id = 1 RETURNING value').one().value as number;
  const log = (table: string, id: number, field: string, oldV: unknown, newV: unknown) =>
    sql.exec(
      'INSERT INTO change_log (table_name, row_id, field, old_value, new_value, mutation_id, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      table, id, field, str(oldV), str(newV), m.id, user, now,
    );

  for (const p of planned) {
    // Codes are unique, and deleted rows are kept as tombstones. Move a deleted row's code aside so it can be
    // used again; nobody sees deleted rows, so the change isn't synced or logged.
    if ((p.table === 'locations' || p.table === 'kits') && p.fields.code != null) {
      sql.exec(`UPDATE ${p.table} SET code = code || '~deleted-' || id WHERE code = ? AND deleted_at IS NOT NULL`, p.fields.code);
    }
    if (p.insert) {
      const cols = Object.keys(p.fields);
      sql.exec(
        `INSERT INTO ${p.table} (id, ${cols.join(', ')}, version, updated_at, updated_by) VALUES (?, ${cols.map(() => '?').join(', ')}, ?, ?, ?)`,
        p.id, ...cols.map((c) => p.fields[c]), version, now, user,
      );
      log(p.table, p.id, '_created', null, JSON.stringify(p.fields));
      continue;
    }
    const before = sql.exec(`SELECT * FROM ${p.table} WHERE id = ?`, p.id).toArray()[0] as Record<string, unknown> | undefined;
    if (!before) throw new Rejection(`${p.table} ${p.id} not found`);
    const cols = Object.keys(p.fields);
    if (!cols.length) continue;
    sql.exec(
      `UPDATE ${p.table} SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = ?, updated_at = ?, updated_by = ? WHERE id = ?`,
      ...cols.map((c) => p.fields[c]), version, now, user, p.id,
    );
    for (const c of cols) if (before[c] !== p.fields[c]) log(p.table, p.id, c, before[c], p.fields[c]);
  }
  sql.exec('INSERT INTO applied_mutations (mutation_id, applied_at) VALUES (?, ?)', m.id, now);
}

/** Apply mutations in order. Bad ones are rejected; the rest still apply. */
export function applyMutations(storage: DurableObjectStorage, user: string, mutations: Mutation[]): MutationResult[] {
  const sql = storage.sql;
  const results: MutationResult[] = [];
  for (const m of mutations.slice(0, MAX_MUTATIONS)) {
    if (typeof m?.id !== 'string' || !m.id) {
      results.push({ id: String(m?.id), status: 'rejected', error: 'missing mutation id' });
      continue;
    }
    if (sql.exec('SELECT 1 FROM applied_mutations WHERE mutation_id = ?', m.id).toArray().length) {
      results.push({ id: m.id, status: 'duplicate' });
      continue;
    }
    const now = new Date().toISOString();
    try {
      const planned = plan(m, now);
      storage.transactionSync(() => applyOne(sql, m, planned, user, now));
      results.push({ id: m.id, status: 'applied' });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (!(e instanceof Rejection)) console.error('mutation rejected by SQLite', m.id, m.label, error);
      results.push({ id: m.id, status: 'rejected', error });
    }
  }
  return results;
}
