// Small in-memory inventory for unit tests of the shared rules.
import { buildCatalog, type RowSets } from '../shared/inventory';
import { toSearchKey } from '../shared/normalize';
import type { Consumption, Item, Kit, Location, Placement } from '../shared/schema';

const meta = { version: 1, updated_at: '2026-01-01T00:00:00Z', updated_by: 'test', deleted_at: null };

export function kit(id: number, code: string): Kit {
  return { ...meta, id, code, name: `${code} kit`, received_at: null };
}

export function loc(id: number, code: string): Location {
  return { ...meta, id, code, type: code.startsWith('B') ? 'bin' : 'shelf', description: null };
}

export function item(id: number, kit_id: number, stock_code: string, over: Partial<Item> = {}): Item {
  return {
    ...meta, id, kit_id, parent_id: null, item_type: 'part', stock_code, search_key: toSearchKey(stock_code),
    description: null, qty: 1, unit: 'ea', vans_bin: null, status: 'expected', source: 'import', notes: null,
    sort_order: id, photo_key: null, qty_received: null, ...over,
  };
}

export function placement(id: number, item_id: number, location_id: number, qty: number | null = null): Placement {
  return { ...meta, id, item_id, location_id, qty };
}

export function consumption(id: number, item_id: number, qty: number): Consumption {
  return { ...meta, id, item_id, qty, pick_list_id: null, note: null };
}

/**
 * EMP kit: BAG 1118 (in B03) holding AN470AD4-5 by weight, and LP4-3 (225 ea, own placement in B07).
 * FUSE kit: AN470AD4-5 again, on shelf S1-B.
 */
export function sampleCatalog(extra: Partial<RowSets> = {}) {
  const rows: RowSets = {
    kits: [kit(1, 'EMP'), kit(2, 'FUSE')],
    locations: [loc(10, 'B03'), loc(11, 'B07'), loc(12, 'S1-B')],
    items: [
      item(100, 1, '14 EMP HARDWARE', { item_type: 'subkit' }),
      item(101, 1, 'BAG 1118', { item_type: 'bag', parent_id: 100 }),
      item(102, 1, 'AN470AD4-5', { parent_id: 101, qty: 0.11, unit: 'lb', description: 'RIVET (LB)' }),
      item(103, 1, 'LP4-3', { parent_id: 101, qty: 225 }),
      item(200, 2, 'AN470AD4-5', { qty: 0.24, unit: 'lb' }),
    ],
    placements: [placement(1000, 101, 10), placement(1001, 103, 11), placement(1002, 200, 12)],
    pick_lists: [],
    pick_list_lines: [],
    consumptions: [consumption(3000, 103, 40)],
    ...extra,
  };
  return buildCatalog(rows);
}
