// User-level operations, expressed as ops and committed as one mutation each.
import {
  descendants, effectiveLocation, onHandQty, remaining, type Catalog,
} from '../../shared/inventory';
import { normalizeLocationCode, toSearchKey } from '../../shared/normalize';
import type { Item, ItemStatus, LocationType, Op, Placement } from '../../shared/schema';
import { commit, deleteOp, insertOp, updateOp } from './mutate';
import { discard } from './photos';

/** Quantity that placements should add up to: remaining for counted items, qty for weight. */
export function storedQty(cat: Catalog, item: Item): number {
  return remaining(cat, item) ?? onHandQty(item);
}

/** Put all of an item at one location. Returns the ops and an undo op list. */
export function placeOps(cat: Catalog, item: Item, locationId: number): { ops: Op[]; undo: Op[] } {
  const own = cat.placementsByItem.get(item.id) ?? [];
  const add = insertOp('placements', { item_id: item.id, location_id: locationId, qty: null });
  const ops: Op[] = [...own.map((p) => deleteOp('placements', p.id)), add];
  const undo: Op[] = [deleteOp('placements', add.id), ...own.map((p) => updateOp('placements', p.id, { deleted_at: null }))];
  return { ops, undo };
}

export async function putAway(cat: Catalog, item: Item, locationId: number) {
  const { ops, undo } = placeOps(cat, item, locationId);
  const code = cat.locations.get(locationId)?.code ?? '';
  await commit(`Put away ${item.stock_code} in ${code}`, ops);
  return undo;
}

export async function undo(label: string, ops: Op[]) {
  await commit(label, ops);
}

/** Move everything, optionally dragging along bag contents that are stored elsewhere. */
export async function moveAll(cat: Catalog, item: Item, locationId: number, alsoMove: Item[] = []) {
  const ops: Op[] = [];
  for (const it of [item, ...alsoMove]) {
    if (it !== item) {
      // Followers go back to inheriting from the bag.
      for (const p of cat.placementsByItem.get(it.id) ?? []) ops.push(deleteOp('placements', p.id));
      continue;
    }
    ops.push(...placeOps(cat, it, locationId).ops);
  }
  const code = cat.locations.get(locationId)?.code ?? '';
  await commit(`Move ${item.stock_code} to ${code}`, ops);
}

/**
 * Move part of a quantity. `from` is one of the item's effective placements (own or inherited).
 * Inherited locations become the item's own placements so the split can be recorded.
 */
export async function moveQty(cat: Catalog, item: Item, from: Placement, toLocationId: number, qty: number) {
  const eff = effectiveLocation(cat, item);
  const total = storedQty(cat, item);
  const ops: Op[] = [];
  // Materialize current placements as the item's own, with explicit quantities.
  let current: { id: number; location_id: number; qty: number; isNew: boolean }[];
  if (eff.inheritedFrom || !eff.placements.length) {
    current = eff.placements.map((p) => ({ id: 0, location_id: p.location_id, qty: p.qty ?? total, isNew: true }));
  } else {
    current = eff.placements.map((p) => ({ id: p.id, location_id: p.location_id, qty: p.qty ?? total, isNew: false }));
  }
  const src = current.find((c) => c.location_id === from.location_id);
  if (!src) throw new Error('source location not found');
  src.qty -= qty;
  const dest = current.find((c) => c.location_id === toLocationId);
  if (dest) dest.qty += qty;
  else current.push({ id: 0, location_id: toLocationId, qty, isNew: true });

  const keep = current.filter((c) => c.qty > 1e-9);
  const single = keep.length === 1 && Math.abs(keep[0].qty - total) < 1e-9;
  for (const c of current) {
    const alive = c.qty > 1e-9;
    const q = single ? null : c.qty;
    if (c.isNew) {
      if (alive) ops.push(insertOp('placements', { item_id: item.id, location_id: c.location_id, qty: q }));
    } else if (alive) {
      ops.push(updateOp('placements', c.id, { qty: q }));
    } else {
      ops.push(deleteOp('placements', c.id));
    }
  }
  const code = cat.locations.get(toLocationId)?.code ?? '';
  await commit(`Move ${qty} ${item.stock_code} to ${code}`, ops);
}

/** Drop the item's own placements so it inherits from its bag again. */
export async function useParentLocation(cat: Catalog, item: Item) {
  const own = cat.placementsByItem.get(item.id) ?? [];
  await commit(`${item.stock_code}: use bag location`, own.map((p) => deleteOp('placements', p.id)));
}

/** Set a status. Bags and sub-kits set every item inside them too. */
export async function setStatus(cat: Catalog, item: Item, status: ItemStatus) {
  const targets = [item, ...(item.item_type === 'part' ? [] : descendants(cat, item))];
  // Marking something received means it all arrived, so a short count from before no longer applies.
  const clears = (t: Item) => status === 'received' && t.qty_received != null;
  const ops = targets
    .filter((t) => t.status !== status || clears(t))
    .map((t) => updateOp('items', t.id, clears(t) ? { status, qty_received: null } : { status }));
  await commit(`Mark ${item.stock_code} ${status}`, ops);
}

/**
 * Record how many of a part arrived. All of it: received. None: missing. Some: backordered, so the shortfall
 * shows up under Problems on the Receiving screen.
 */
export async function setReceivedQty(item: Item, n: number) {
  const status: ItemStatus = n >= item.qty ? 'received' : n <= 0 ? 'missing' : 'backordered';
  await commit(`Received ${n} of ${item.stock_code}`, [
    updateOp('items', item.id, { status, qty_received: n >= item.qty ? null : n }),
  ]);
}

export async function markKitReceived(cat: Catalog, kitId: number) {
  const ops: Op[] = [];
  for (const it of cat.items.values()) {
    if (it.kit_id === kitId && it.status === 'expected') ops.push(updateOp('items', it.id, { status: 'received' }));
  }
  ops.push(updateOp('kits', kitId, { received_at: new Date().toISOString() }));
  await commit('Mark kit received', ops);
}

export async function consume(item: Item, qty: number, pickListId: number | null, note: string | null) {
  await commit(`Consumed ${qty} ${item.stock_code}`, [
    insertOp('consumptions', { item_id: item.id, qty, pick_list_id: pickListId, note }),
  ]);
}

export async function createLocation(code: string, type: LocationType, description: string | null) {
  const op = insertOp('locations', { code: normalizeLocationCode(code), type, description });
  await commit(`Add location ${normalizeLocationCode(code)}`, [op]);
  return op.id;
}

/** Add several locations as one change, e.g. every slot on a shelf. */
export async function createLocations(locs: { code: string; type: LocationType; description: string | null }[]) {
  if (!locs.length) return;
  const ops = locs.map((l) => insertOp('locations', { code: normalizeLocationCode(l.code), type: l.type, description: l.description }));
  await commit(`Add ${locs.length} location${locs.length === 1 ? '' : 's'}`, ops);
}

export function guessLocationType(code: string): LocationType {
  const c = normalizeLocationCode(code);
  if (/^B\d/.test(c)) return 'bin';
  if (/^S\d/.test(c)) return 'shelf';
  if (c.startsWith('CRATE')) return 'crate';
  if (c.startsWith('RACK')) return 'rack';
  return 'other';
}

export async function deleteItem(cat: Catalog, item: Item) {
  const all = [item, ...descendants(cat, item)];
  const ops: Op[] = [];
  for (const it of all) {
    for (const p of cat.placementsByItem.get(it.id) ?? []) ops.push(deleteOp('placements', p.id));
    ops.push(deleteOp('items', it.id));
  }
  await commit(`Delete ${item.stock_code}`, ops);
  for (const it of all) discard(it.photo_key);
}

export function itemFields(stock_code: string) {
  return { stock_code: stock_code.trim(), search_key: toSearchKey(stock_code) };
}
