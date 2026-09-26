import { newId, type Op, type Rows, type TableName } from '../../shared/schema';
import { db } from './idb';
import { outbox, recompute } from './store';
import { scheduleSync } from './sync';

type Writable<T extends TableName> = Partial<Omit<Rows[T], 'id' | 'version' | 'updated_at' | 'updated_by'>>;

export function insertOp<T extends TableName>(table: T, fields: Writable<T>, id = newId()): Op & { op: 'insert' } {
  return { op: 'insert', table, id, fields: fields as Record<string, unknown> };
}

export function updateOp<T extends TableName>(table: T, id: number, fields: Writable<T>): Op {
  return { op: 'update', table, id, fields: fields as Record<string, unknown> };
}

export function deleteOp(table: TableName, id: number): Op {
  return { op: 'delete', table, id };
}

/** Record one user action: apply it locally now, queue it for the server. */
export async function commit(label: string, ops: Op[]) {
  if (!ops.length) return;
  const mutation = { id: crypto.randomUUID(), label, created_at: new Date().toISOString(), ops };
  const seq = await (await db()).add('outbox', { mutation });
  outbox.value = [...outbox.value, { seq, mutation }];
  recompute();
  scheduleSync();
  return mutation;
}
