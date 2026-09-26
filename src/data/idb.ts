import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Mutation, MutationResult, Rows } from '../../shared/schema';

export interface OutboxEntry {
  seq?: number;
  mutation: Mutation;
}

export interface RejectedEntry {
  mutation: Mutation;
  result: MutationResult;
  rejected_at: string;
}

/** One local database per warehouse: its rows, outbox and settings. */
interface WarehouseDB extends DBSchema {
  kits: { key: number; value: Rows['kits'] };
  locations: { key: number; value: Rows['locations'] };
  items: { key: number; value: Rows['items'] };
  placements: { key: number; value: Rows['placements'] };
  pick_lists: { key: number; value: Rows['pick_lists'] };
  pick_list_lines: { key: number; value: Rows['pick_list_lines'] };
  consumptions: { key: number; value: Rows['consumptions'] };
  outbox: { key: number; value: OutboxEntry };
  rejected: { key: string; value: RejectedEntry };
  meta: { key: string; value: unknown };
}

/** App-wide settings: who's signed in, which warehouse is open. */
interface AppDB extends DBSchema {
  meta: { key: string; value: unknown };
}

export type Store = 'kits' | 'locations' | 'items' | 'placements' | 'pick_lists' | 'pick_list_lines' | 'consumptions';

// Local databases from before warehouses existed.
for (const old of ['rv14a-inventory', 'nowstocking']) {
  try { indexedDB.deleteDatabase(old); } catch { /* not available */ }
}

let appDbp: Promise<IDBPDatabase<AppDB>> | undefined;
function appDb() {
  appDbp ??= openDB<AppDB>('nowstocking-app', 1, { upgrade: (d) => void d.createObjectStore('meta') });
  return appDbp;
}

export async function getGlobal<T>(key: string, fallback: T): Promise<T> {
  return ((await (await appDb()).get('meta', key)) as T | undefined) ?? fallback;
}

export async function setGlobal(key: string, value: unknown) {
  await (await appDb()).put('meta', value, key);
}

let warehouseId: string | null = null;
let dbp: Promise<IDBPDatabase<WarehouseDB>> | undefined;

/** Point local storage at a warehouse. Closes the previous warehouse's database. */
export async function useWarehouseDb(id: string | null) {
  if (id === warehouseId) return;
  const prev = dbp;
  dbp = undefined;
  warehouseId = id;
  if (prev) (await prev).close();
}

export function db() {
  if (!warehouseId) throw new Error('No warehouse selected');
  dbp ??= openDB<WarehouseDB>(`nowstocking-w-${warehouseId}`, 1, {
    upgrade(d) {
      for (const t of ['kits', 'locations', 'items', 'placements', 'pick_lists', 'pick_list_lines', 'consumptions'] as const) {
        d.createObjectStore(t, { keyPath: 'id' });
      }
      d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      d.createObjectStore('rejected', { keyPath: 'mutation.id' });
      d.createObjectStore('meta');
    },
  });
  return dbp;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const v = await (await db()).get('meta', key);
  return (v as T | undefined) ?? fallback;
}

export async function setMeta(key: string, value: unknown) {
  await (await db()).put('meta', value, key);
}
