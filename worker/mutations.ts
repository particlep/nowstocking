// Applies queued client edits. Each mutation is one D1 batch (a transaction), applied at most once.
import { normalizeLocationCode, toSearchKey } from '../shared/normalize';
import {
  TABLE_NAMES, WRITABLE,
  type Mutation, type MutationResult, type MutationsResponse, type Op, type TableName,
} from '../shared/schema';
import { currentVersion } from './rows';

/** D1 allows 50 queries per invocation on the free plan. Stop short and let the client resend the rest. */
const QUERY_BUDGET = 45;
const MAX_OPS = 5000;
const VERSION = '(SELECT value FROM sync_counter WHERE id = 1)';

const DEFAULTS: Partial<Record<TableName, Record<string, Scalar>>> = {
  kits: { received_at: null },
  locations: { description: null },
  items: { parent_id: null, description: null, vans_bin: null, status: 'expected', source: 'manual', notes: null },
  placements: { qty: null },
  pick_lists: { page: null, title: null },
  pick_list_lines: { qty_needed: null, pulled: 0 },
  consumptions: { pick_list_id: null, note: null },
};

type Scalar = string | number | null;

interface Planned {
  table: TableName;
  id: number;
  insert: boolean;
  fields: Record<string, Scalar>;
}

class Rejection extends Error {}

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
  return out;
}

/** Validate ops and fold several ops on the same row into one. */
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
  return [...byRow.values()];
}

function statementsFor(
  db: D1Database, m: Mutation, planned: Planned[], old: Map<string, Record<string, unknown>>, user: string, now: string,
): D1PreparedStatement[] {
  const stmts: D1PreparedStatement[] = [db.prepare('UPDATE sync_counter SET value = value + 1 WHERE id = 1')];
  const log: Record<string, Scalar>[] = [];

  for (const table of TABLE_NAMES) {
    // Inserts: one statement per table, rows passed as a JSON array.
    const inserts = planned.filter((p) => p.table === table && p.insert);
    if (inserts.length) {
      const cols = WRITABLE[table].filter((c) => c !== 'deleted_at') as string[];
      if (table === 'items' || table === 'pick_list_lines') cols.includes('search_key') || cols.push('search_key');
      const sql =
        `INSERT INTO ${table} (id, ${cols.join(', ')}, version, updated_at, updated_by) ` +
        `SELECT json_extract(value, '$.id'), ${cols.map((c) => `json_extract(value, '$.${c}')`).join(', ')}, ${VERSION}, ?, ? ` +
        `FROM json_each(?)`;
      stmts.push(db.prepare(sql).bind(now, user, JSON.stringify(inserts.map((p) => ({ id: p.id, ...p.fields })))));
      for (const p of inserts) {
        log.push({ table_name: table, row_id: p.id, field: '_created', old_value: null, new_value: JSON.stringify(p.fields) });
      }
    }

    // Updates: group rows that set the same fields into one UPDATE ... FROM json_each.
    const groups = new Map<string, Planned[]>();
    for (const p of planned) {
      if (p.table !== table || p.insert) continue;
      const before = old.get(`${table}:${p.id}`);
      if (!before) throw new Rejection(`${table} ${p.id} not found`);
      const changed = Object.keys(p.fields).filter((f) => before[f] !== p.fields[f]);
      for (const f of changed) {
        log.push({
          table_name: table, row_id: p.id, field: f,
          old_value: before[f] == null ? null : String(before[f]),
          new_value: p.fields[f] == null ? null : String(p.fields[f]),
        });
      }
      const sig = Object.keys(p.fields).sort().join(',');
      if (!sig) continue;
      const list = groups.get(sig);
      if (list) list.push(p);
      else groups.set(sig, [p]);
    }
    for (const [sig, rows] of groups) {
      const cols = sig.split(',');
      const sql =
        `UPDATE ${table} SET ${cols.map((c) => `${c} = json_extract(j.value, '$.${c}')`).join(', ')}, ` +
        `version = ${VERSION}, updated_at = ?, updated_by = ? ` +
        `FROM json_each(?) AS j WHERE ${table}.id = json_extract(j.value, '$.id')`;
      stmts.push(db.prepare(sql).bind(now, user, JSON.stringify(rows.map((p) => ({ id: p.id, ...p.fields })))));
    }
  }

  if (log.length) {
    stmts.push(
      db.prepare(
        `INSERT INTO change_log (table_name, row_id, field, old_value, new_value, mutation_id, changed_by, changed_at) ` +
        `SELECT json_extract(value, '$.table_name'), json_extract(value, '$.row_id'), json_extract(value, '$.field'), ` +
        `json_extract(value, '$.old_value'), json_extract(value, '$.new_value'), ?, ?, ? FROM json_each(?)`,
      ).bind(m.id, user, now, JSON.stringify(log)),
    );
  }
  stmts.push(db.prepare('INSERT INTO applied_mutations (mutation_id, applied_at) VALUES (?, ?)').bind(m.id, now));
  return stmts;
}

async function readOld(db: D1Database, planned: Planned[]): Promise<{ old: Map<string, Record<string, unknown>>; queries: number }> {
  const idsByTable = new Map<TableName, number[]>();
  for (const p of planned) {
    if (p.insert) continue;
    const list = idsByTable.get(p.table);
    if (list) list.push(p.id);
    else idsByTable.set(p.table, [p.id]);
  }
  const old = new Map<string, Record<string, unknown>>();
  if (!idsByTable.size) return { old, queries: 0 };
  const tables = [...idsByTable.keys()];
  const results = await db.batch(
    tables.map((t) =>
      db.prepare(`SELECT * FROM ${t} WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify(idsByTable.get(t))),
    ),
  );
  tables.forEach((t, i) => {
    for (const row of results[i].results as Record<string, unknown>[]) old.set(`${t}:${row.id}`, row);
  });
  return { old, queries: tables.length };
}

/**
 * Applies mutations in order. Returns results only for the mutations it got to;
 * the client keeps the rest in its outbox and sends them next time.
 */
export async function applyMutations(db: D1Database, user: string, mutations: Mutation[]): Promise<MutationsResponse> {
  const results: MutationResult[] = [];
  const ids = mutations.map((m) => m.id).filter((id) => typeof id === 'string');
  const dupRows = await db
    .prepare('SELECT mutation_id FROM applied_mutations WHERE mutation_id IN (SELECT value FROM json_each(?))')
    .bind(JSON.stringify(ids))
    .all<{ mutation_id: string }>();
  const done = new Set(dupRows.results.map((r) => r.mutation_id));
  let used = 2; // duplicate check + final version read

  for (const m of mutations) {
    if (typeof m.id !== 'string' || !m.id) {
      results.push({ id: String(m.id), status: 'rejected', error: 'missing mutation id' });
      continue;
    }
    if (done.has(m.id)) {
      results.push({ id: m.id, status: 'duplicate' });
      continue;
    }
    const now = new Date().toISOString();
    try {
      const planned = plan(m, now);
      if (results.length && used + 10 > QUERY_BUDGET) break;
      const { old, queries } = await readOld(db, planned);
      used += queries;
      const stmts = statementsFor(db, m, planned, old, user, now);
      if (results.length && used + stmts.length > QUERY_BUDGET) break;
      await db.batch(stmts);
      used += stmts.length;
      done.add(m.id);
      results.push({ id: m.id, status: 'applied' });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      if (!(e instanceof Rejection)) {
        console.error('mutation failed', m.id, m.label, error);
        // Only constraint failures are the edit's fault. Anything else (D1 overloaded, network)
        // is transient: stop here so the client retries this mutation instead of dropping it.
        if (!/constraint|mismatch/i.test(error)) {
          if (!results.length) throw e;
          break;
        }
      }
      results.push({ id: m.id, status: 'rejected', error });
    }
  }
  return { results, version: await currentVersion(db) };
}
