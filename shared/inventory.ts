// Derived views over the raw rows: effective locations, remaining counts, CSV.
import type { Consumption, Item, Kit, Location, Placement, Rows, TableName } from './schema';

export type RowSets = { [T in TableName]: Iterable<Rows[T]> };

export interface Catalog {
  kits: Map<number, Kit>;
  locations: Map<number, Location>;
  locationsByCode: Map<string, Location>;
  items: Map<number, Item>;
  children: Map<number | null, Item[]>;
  placementsByItem: Map<number, Placement[]>;
  placementsByLocation: Map<number, Placement[]>;
  consumptionsByItem: Map<number, Consumption[]>;
  itemsBySearchKey: Map<string, Item[]>;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Index live (non-deleted) rows. Rows pointing at deleted parents are dropped too. */
export function buildCatalog(rows: RowSets): Catalog {
  const cat: Catalog = {
    kits: new Map(),
    locations: new Map(),
    locationsByCode: new Map(),
    items: new Map(),
    children: new Map(),
    placementsByItem: new Map(),
    placementsByLocation: new Map(),
    consumptionsByItem: new Map(),
    itemsBySearchKey: new Map(),
  };
  for (const k of rows.kits) if (!k.deleted_at) cat.kits.set(k.id, k);
  for (const l of rows.locations) {
    if (l.deleted_at) continue;
    cat.locations.set(l.id, l);
    cat.locationsByCode.set(l.code, l);
  }
  for (const i of rows.items) if (!i.deleted_at && cat.kits.has(i.kit_id)) cat.items.set(i.id, i);
  // Drop items whose ancestor chain is broken (deleted bag, deleted sub-kit).
  for (const i of [...cat.items.values()]) {
    let p = i.parent_id;
    let ok = true;
    for (let depth = 0; p != null && depth < 10; depth++) {
      const parent = cat.items.get(p);
      if (!parent) { ok = false; break; }
      p = parent.parent_id;
    }
    if (!ok) cat.items.delete(i.id);
  }
  for (const i of cat.items.values()) {
    push(cat.children, i.parent_id, i);
    push(cat.itemsBySearchKey, i.search_key, i);
  }
  for (const list of cat.children.values()) list.sort(bySortOrder);
  for (const p of rows.placements) {
    if (p.deleted_at || !cat.items.has(p.item_id) || !cat.locations.has(p.location_id)) continue;
    push(cat.placementsByItem, p.item_id, p);
    push(cat.placementsByLocation, p.location_id, p);
  }
  for (const c of rows.consumptions) {
    if (c.deleted_at || !cat.items.has(c.item_id)) continue;
    push(cat.consumptionsByItem, c.item_id, c);
  }
  return cat;
}

export function bySortOrder(a: Item, b: Item) {
  return a.sort_order - b.sort_order || a.id - b.id;
}

export interface EffectiveLocation {
  placements: Placement[];
  /** The bag or sub-kit the location came from, or null when the item has its own placements. */
  inheritedFrom: Item | null;
}

/** Own placements, else the nearest ancestor's. */
export function effectiveLocation(cat: Catalog, item: Item): EffectiveLocation {
  const own = cat.placementsByItem.get(item.id);
  if (own?.length) return { placements: own, inheritedFrom: null };
  let p = item.parent_id;
  for (let depth = 0; p != null && depth < 10; depth++) {
    const parent = cat.items.get(p);
    if (!parent) break;
    const pl = cat.placementsByItem.get(parent.id);
    if (pl?.length) return { placements: pl, inheritedFrom: parent };
    p = parent.parent_id;
  }
  return { placements: [], inheritedFrom: null };
}

/** "B03" or "B03 (100); B04 (125)". Empty string when unplaced. */
export function formatLocations(cat: Catalog, placements: Placement[]): string {
  return placements
    .map((p) => {
      const code = cat.locations.get(p.location_id)?.code ?? '?';
      return p.qty == null ? code : `${code} (${fmtQty(p.qty)})`;
    })
    .join('; ');
}

export function consumed(cat: Catalog, item: Item): number {
  return (cat.consumptionsByItem.get(item.id) ?? []).reduce((s, c) => s + c.qty, 0);
}

/** Null for items sold by weight: they never show consumed or remaining. */
export function remaining(cat: Catalog, item: Item): number | null {
  if (item.unit === 'lb') return null;
  return item.qty - consumed(cat, item);
}

/** True when an item's split placements don't add up to its remaining quantity. */
export function splitMismatch(cat: Catalog, item: Item): boolean {
  const own = cat.placementsByItem.get(item.id) ?? [];
  if (own.length < 2 || own.some((p) => p.qty == null)) return false;
  const total = own.reduce((s, p) => s + (p.qty ?? 0), 0);
  const target = item.unit === 'lb' ? item.qty : item.qty - consumed(cat, item);
  return Math.abs(total - target) > 1e-6;
}

export function ancestors(cat: Catalog, item: Item): Item[] {
  const out: Item[] = [];
  let p = item.parent_id;
  for (let depth = 0; p != null && depth < 10; depth++) {
    const parent = cat.items.get(p);
    if (!parent) break;
    out.unshift(parent);
    p = parent.parent_id;
  }
  return out;
}

export function descendants(cat: Catalog, item: Item): Item[] {
  const out: Item[] = [];
  const walk = (id: number) => {
    for (const c of cat.children.get(id) ?? []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(item.id);
  return out;
}

/** Items stored at a location: directly placed ones plus descendants that inherit from them. */
export function itemsAtLocation(cat: Catalog, locationId: number): { item: Item; placement: Placement; inherited: boolean }[] {
  const out: { item: Item; placement: Placement; inherited: boolean }[] = [];
  for (const placement of cat.placementsByLocation.get(locationId) ?? []) {
    const item = cat.items.get(placement.item_id);
    if (!item) continue;
    out.push({ item, placement, inherited: false });
    const walk = (id: number) => {
      for (const c of cat.children.get(id) ?? []) {
        if (cat.placementsByItem.get(c.id)?.length) continue; // has its own location
        out.push({ item: c, placement, inherited: true });
        walk(c.id);
      }
    };
    walk(item.id);
  }
  return out;
}

/** Children of a bag that do NOT follow it (they have their own placements). */
export function childrenStoredElsewhere(cat: Catalog, item: Item): Item[] {
  return descendants(cat, item).filter((d) => cat.placementsByItem.get(d.id)?.length);
}

export function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(cat: Catalog): string {
  const header = [
    'kit', 'subkit', 'bag', 'type', 'stock_code', 'description', 'qty', 'unit', 'consumed', 'remaining',
    'status', 'vans_bin', 'locations', 'location_inherited_from', 'notes', 'source',
  ];
  const lines = [header.join(',')];
  const kits = [...cat.kits.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const kit of kits) {
    const walk = (parentId: number | null) => {
      for (const item of cat.children.get(parentId) ?? []) {
        if (item.kit_id !== kit.id) continue;
        const anc = ancestors(cat, item);
        const subkit = anc.find((a) => a.item_type === 'subkit');
        const bag = anc.find((a) => a.item_type === 'bag');
        const eff = effectiveLocation(cat, item);
        const rem = item.item_type === 'part' ? remaining(cat, item) : null;
        lines.push(
          [
            kit.code, subkit?.stock_code, bag?.stock_code, item.item_type, item.stock_code, item.description,
            fmtQty(item.qty), item.unit, rem == null ? '' : fmtQty(consumed(cat, item)), rem == null ? '' : fmtQty(rem),
            item.status, item.vans_bin, formatLocations(cat, eff.placements), eff.inheritedFrom?.stock_code,
            item.notes, item.source,
          ].map(csvCell).join(','),
        );
        walk(item.id);
      }
    };
    walk(null);
  }
  return lines.join('\r\n') + '\r\n';
}
