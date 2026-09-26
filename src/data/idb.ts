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

interface InventoryDB extends DBSchema {
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

export type Store = 'kits' | 'locations' | 'items' | 'placements' | 'pick_lists' | 'pick_list_lines' | 'consumptions';

let dbp: Promise<IDBPDatabase<InventoryDB>> | undefined;

export function db() {
  dbp ??= openDB<InventoryDB>('rv14a-inventory', 1, {
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
