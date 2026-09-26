// Who's signed in and which warehouse is open. Everything else in the app works inside one warehouse.
import { computed, signal } from '@preact/signals';
import type { AccountInfo, MeResponse, WarehouseInfo } from '../../shared/directory';
import { api } from './api';
import { getGlobal, setGlobal, useWarehouseDb } from './idb';
import { loadFromIdb, me, resetStore } from './store';

export const identity = signal<MeResponse | null>(null);
/** How this install signs people in. "email" shows the app's own sign-in screen. */
export const authMode = signal<'access' | 'email'>('access');
export const warehouseId = signal<string | null>(null);

export const current = computed<{ account: AccountInfo; warehouse: WarehouseInfo } | null>(() => {
  const wid = warehouseId.value;
  for (const account of identity.value?.accounts ?? []) {
    const warehouse = account.warehouses.find((w) => w.id === wid);
    if (warehouse) return { account, warehouse };
  }
  return null;
});

export const allWarehouses = computed(() =>
  (identity.value?.accounts ?? []).flatMap((a) => a.warehouses.map((w) => ({ ...w, account: a }))),
);

/** API path inside the open warehouse: wpath('/sync') -> /api/w/<id>/sync. */
export function wpath(path: string): string {
  if (!warehouseId.value) throw new Error('No warehouse selected');
  return `/api/w/${warehouseId.value}${path}`;
}

/** Open a warehouse: point local storage at it and load its rows. */
export async function openWarehouse(id: string) {
  if (id === warehouseId.value) return;
  resetStore();
  await useWarehouseDb(id);
  warehouseId.value = id;
  await setGlobal('warehouseId', id);
  await loadFromIdb();
}

/** Startup, works offline: the last identity and warehouse this phone saw. */
export async function loadIdentity() {
  authMode.value = await getGlobal<'access' | 'email'>('authMode', 'access');
  // Wait for the answer (offline it fails fast), so the right sign-in screen shows from the start.
  await api<{ mode: 'access' | 'email' }>('/api/auth/config')
    .then((r) => { authMode.value = r.mode; return setGlobal('authMode', r.mode); })
    .catch(() => {});
  identity.value = await getGlobal<MeResponse | null>('identity', null);
  if (identity.value) me.value = identity.value.user.email;
  const saved = await getGlobal<string | null>('warehouseId', null);
  if (saved) await openWarehouse(saved);
}

/** Ask the server who we are. Opens the first warehouse if none is open or the open one went away. */
export async function refreshIdentity() {
  const r = await api<MeResponse>('/api/me');
  identity.value = r;
  me.value = r.user.email;
  await setGlobal('identity', r);
  const ids = r.accounts.flatMap((a) => a.warehouses.map((w) => w.id));
  if (!warehouseId.value || !ids.includes(warehouseId.value)) {
    if (ids[0]) await openWarehouse(ids[0]);
  }
}

/** Sign out (email sign-in only). Removes this phone's copies of the warehouses, so the next person doesn't see them. */
export async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  const ids = allWarehouses.value.map((w) => w.id);
  resetStore();
  await useWarehouseDb(null);
  warehouseId.value = null;
  identity.value = null;
  await setGlobal('identity', null);
  await setGlobal('warehouseId', null);
  for (const id of ids) {
    try { indexedDB.deleteDatabase(`nowstocking-w-${id}`); } catch { /* ignore */ }
  }
}
