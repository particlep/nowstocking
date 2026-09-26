import { TABLE_NAMES, type MutationsResponse, type Rows, type SyncResponse, type TableName } from '../../shared/schema';
import { api, SignInRequired } from './api';
import { db, getMeta, setMeta } from './idb';
import {
  getServerRows, lastSyncedAt, outbox, rejected, setServerRows, syncError, syncState, type Tables,
} from './store';
import { refreshIdentity, warehouseId, wpath } from './workspace';

export { api, SignInRequired };

const PUSH_BATCH = 25;

async function push() {
  const d = await db();
  for (let rounds = 0; rounds < 200 && outbox.value.length; rounds++) {
    const batch = outbox.value.slice(0, PUSH_BATCH);
    const res = await api<MutationsResponse>(wpath('/mutations'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mutations: batch.map((e) => e.mutation) }),
    });
    if (!res.results.length) break;
    const settled = new Set<string>();
    const tx = d.transaction(['outbox', 'rejected'], 'readwrite');
    for (const r of res.results) {
      const entry = batch.find((e) => e.mutation.id === r.id);
      if (!entry) continue;
      settled.add(r.id);
      await tx.objectStore('outbox').delete(entry.seq!);
      if (r.status === 'rejected') {
        await tx.objectStore('rejected').put({ mutation: entry.mutation, result: r, rejected_at: new Date().toISOString() });
      }
    }
    await tx.done;
    outbox.value = outbox.value.filter((e) => !settled.has(e.mutation.id));
    rejected.value = await d.getAll('rejected');
  }
}

async function pull() {
  const d = await db();
  const since = await getMeta<number>('lastVersion', 0);
  let res = await api<SyncResponse>(wpath(`/sync?since=${since}`));
  if (!res.full && res.version < since) {
    // The server's version went backwards: it's a new or reset database. Replace everything.
    res = await api<SyncResponse>(wpath('/sync?since=0'));
  }
  const base = getServerRows();
  const next = { ...base } as Tables;
  const tx = d.transaction([...TABLE_NAMES, 'meta'] as (TableName | 'meta')[], 'readwrite');
  for (const t of TABLE_NAMES) {
    const rows = res.rows[t] as Rows[TableName][];
    if (!res.full && !rows.length) continue;
    const store = tx.objectStore(t);
    const map = res.full ? new Map<number, unknown>() : new Map(base[t] as Map<number, unknown>);
    if (res.full) await store.clear();
    for (const row of rows) {
      await store.put(row as never);
      map.set(row.id, row);
    }
    (next as Record<TableName, Map<number, unknown>>)[t] = map;
  }
  const at = new Date().toISOString();
  await tx.objectStore('meta').put(res.version, 'lastVersion');
  await tx.objectStore('meta').put(at, 'lastSyncedAt');
  await tx.done;
  lastSyncedAt.value = at;
  setServerRows(next);
}

let running: Promise<void> | null = null;
let again = false;

/** Push the outbox, then pull changes. Safe to call often; concurrent calls coalesce. */
export function sync(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      if (!navigator.onLine) {
        syncState.value = 'offline';
        return;
      }
      syncState.value = 'syncing';
      try {
        await refreshIdentity();
        if (warehouseId.value) {
          await push();
          await pull();
        }
        syncState.value = 'idle';
        syncError.value = null;
      } catch (e) {
        if (e instanceof SignInRequired) syncState.value = 'signin';
        else if (e instanceof TypeError) syncState.value = 'offline'; // fetch network failure
        else {
          syncState.value = 'error';
          syncError.value = e instanceof Error ? e.message : String(e);
        }
        return;
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync(delay = 400) {
  clearTimeout(timer);
  timer = setTimeout(() => void sync(), delay);
}

/** Forget the local copy and pull everything again. Pending edits are kept. */
export async function fullResync() {
  await setMeta('lastVersion', 0);
  await sync();
}

export function startSyncLoop() {
  void sync();
  window.addEventListener('online', () => void sync());
  window.addEventListener('offline', () => (syncState.value = 'offline'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sync();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void sync();
  }, 60_000);
}

/** Full page load through Access, which shows its login and returns here. */
export function signIn() {
  window.location.reload();
}
