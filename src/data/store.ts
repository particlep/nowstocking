// In-memory copy of every table, loaded from IndexedDB, plus derived catalog and sync state.
import { computed, signal } from '@preact/signals';
import { buildCatalog } from '../../shared/inventory';
import { TABLE_NAMES, type Op, type Rows, type TableName } from '../../shared/schema';
import { db, getMeta, type OutboxEntry, type RejectedEntry } from './idb';

export type Tables = { [T in TableName]: Map<number, Rows[T]> };

function emptyTables(): Tables {
  return Object.fromEntries(TABLE_NAMES.map((t) => [t, new Map()])) as unknown as Tables;
}

/** Server state as last synced. */
let serverRows: Tables = emptyTables();
/** Server state with pending outbox edits applied on top: what the UI shows. */
export const tables = signal<Tables>(emptyTables());
export const outbox = signal<OutboxEntry[]>([]);
export const rejected = signal<RejectedEntry[]>([]);
export const loaded = signal(false);
export const me = signal<string>('me');

export type SyncState = 'idle' | 'syncing' | 'offline' | 'signin' | 'error';
export const syncState = signal<SyncState>('idle');
export const syncError = signal<string | null>(null);
export const lastSyncedAt = signal<string | null>(null);

export const catalog = computed(() => {
  const t = tables.value;
  return buildCatalog({
    kits: t.kits.values(),
    locations: t.locations.values(),
    items: t.items.values(),
    placements: t.placements.values(),
    pick_lists: t.pick_lists.values(),
    pick_list_lines: t.pick_list_lines.values(),
    consumptions: t.consumptions.values(),
  });
});

export const pendingCount = computed(() => outbox.value.length);

/** Apply ops to a copy-on-write set of tables. Meta fields are filled locally until the server confirms. */
export function applyOps(base: Tables, ops: Op[], user: string, at: string): Tables {
  const next = { ...base } as Tables;
  const touched = new Set<TableName>();
  for (const op of ops) {
    if (!touched.has(op.table)) {
      (next as Record<TableName, Map<number, unknown>>)[op.table] = new Map(base[op.table] as Map<number, unknown>);
      touched.add(op.table);
    }
    const map = next[op.table] as unknown as Map<number, Record<string, unknown>>;
    const existing = map.get(op.id);
    const meta = { version: 0, updated_at: at, updated_by: user };
    if (op.op === 'insert') {
      map.set(op.id, { deleted_at: null, ...defaultsFor(op.table), ...op.fields, ...meta, id: op.id });
    } else if (existing) {
      const fields = op.op === 'delete' ? { deleted_at: at } : op.fields;
      map.set(op.id, { ...existing, ...fields, ...meta });
    }
  }
  return next;
}

function defaultsFor(table: TableName): Record<string, unknown> {
  switch (table) {
    case 'items': return { parent_id: null, description: null, vans_bin: null, status: 'expected', source: 'manual', notes: null };
    case 'placements': return { qty: null };
    case 'pick_list_lines': return { qty_needed: null, pulled: 0 };
    case 'consumptions': return { pick_list_id: null, note: null };
    default: return {};
  }
}

export function recompute() {
  let t = serverRows;
  for (const entry of outbox.value) t = applyOps(t, entry.mutation.ops, me.value, entry.mutation.created_at);
  tables.value = t;
}

export function setServerRows(rows: Tables) {
  serverRows = rows;
  recompute();
}

export function getServerRows() {
  return serverRows;
}

export async function loadFromIdb() {
  const d = await db();
  const t = emptyTables();
  for (const name of TABLE_NAMES) {
    for (const row of await d.getAll(name)) (t[name] as Map<number, unknown>).set(row.id, row);
  }
  serverRows = t;
  outbox.value = await d.getAll('outbox');
  rejected.value = await d.getAll('rejected');
  me.value = await getMeta('me', 'me');
  lastSyncedAt.value = await getMeta<string | null>('lastSyncedAt', null);
  recompute();
  loaded.value = true;
}
