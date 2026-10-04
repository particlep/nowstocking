import { describe, expect, it } from 'vitest';
import {
  buildCsv, childrenStoredElsewhere, effectiveLocation, formatLocations, itemsAtLocation, receivedQty, remaining, splitMismatch,
} from '../shared/inventory';
import changelogText from '../CHANGELOG.md?raw';
import { newSince, parseChangelog } from '../shared/changelog';
import { defaultPrefix, describePrefix, gridLocations } from '../shared/locationGrid';
import { normalizeLocationCode, partFromBarcode, toSearchKey } from '../shared/normalize';
import { buildPartIndex, readPartNumber } from '../shared/partReader';
import { newId } from '../shared/schema';
import { placement, sampleCatalog } from './fixtures';

describe('normalize', () => {
  it('builds search keys from part numbers', () => {
    expect(toSearchKey('AN470AD4-5')).toBe('AN470AD45');
    expect(toSearchKey('bag 1118')).toBe('BAG1118');
    expect(toSearchKey(' ms20470.ad4-4 ')).toBe('MS20470AD44');
  });

  it('normalizes location codes', () => {
    expect(normalizeLocationCode(' b03 ')).toBe('B03');
    expect(normalizeLocationCode('s1 a')).toBe('S1-A');
  });

  it('makes ids that are safe JavaScript integers', () => {
    for (let i = 0; i < 1000; i++) {
      const id = newId();
      expect(Number.isSafeInteger(id)).toBe(true);
      expect(id).toBeGreaterThan(2 ** 32 - 1);
    }
  });
});

describe('part from barcode', () => {
  const keys = ['AN470AD45', 'BAG1118', 'VA140', 'W1010'];
  it('reads a barcode that is just the part number', () => {
    expect(partFromBarcode('AN470AD4-5', keys)).toBe('AN470AD4-5');
    expect(partFromBarcode(' an470ad4-5 ', keys)).toBe('an470ad4-5');
  });
  it('finds the part number among other fields', () => {
    expect(partFromBarcode('BAG 1118', keys)).toBe('BAG 1118');
    expect(partFromBarcode('VA-140 QTY 2', keys)).toBe('VA-140');
    expect(partFromBarcode('12345|W-1010|1', keys)).toBe('W-1010');
  });
  it('finds a part number run together with other text', () => {
    expect(partFromBarcode('PO998877W1010X1', keys)).toBe('W1010');
  });
  it('falls back to the text as scanned', () => {
    expect(partFromBarcode('F-1234', keys)).toBe('F-1234');
  });
});

describe('reading a part number', () => {
  const index = buildPartIndex(['F-01406B', 'AN470AD4-5', 'VA-140', 'W-1010', 'HS-1002', 'HS-1003'].map((c) => ({ stock_code: c, search_key: toSearchKey(c) })));
  const read = (line: string) => readPartNumber(line, index);
  it('snaps a clean read to the catalog part number', () => {
    expect(read('F-01406B')).toEqual({ text: 'F-01406B', known: true });
    expect(read('PART F01406B QTY 2')).toEqual({ text: 'F-01406B', known: true });
  });
  it('joins a part number split in two', () => {
    expect(read('F- 01406B')).toEqual({ text: 'F-01406B', known: true });
  });
  it('forgives characters OCR confuses', () => {
    expect(read('F-O14O6B')).toEqual({ text: 'F-01406B', known: true });
    expect(read('AN47OAD4-S')).toEqual({ text: 'AN470AD4-5', known: true });
    expect(read('F-0I4068')).toEqual({ text: 'F-01406B', known: true });
  });
  it('finds a part number run into the next word', () => {
    expect(read('F-01406BQTY4')).toEqual({ text: 'F-01406B', known: true });
    expect(read('VA-140QTY4')).toEqual({ text: 'VA-140', known: true });
    // Carries on with more digits: a different part, not VA-140.
    expect(read('VA-1407')).toEqual({ text: 'VA-1407', known: false });
  });
  it('allows one character off on longer numbers, when only one part fits', () => {
    expect(read('F-0146B')).toEqual({ text: 'F-01406B', known: true });
    // HS-1002 and HS-1003 are both one off from HS-1004: no guess.
    expect(read('HS-1004')).toEqual({ text: 'HS-1004', known: false });
  });
  it('returns an unknown part number as read, and nothing for plain words', () => {
    expect(read('Bag of rivets MS20470AD4-6')).toEqual({ text: 'MS20470AD4-6', known: false });
    expect(read("VAN'S AIRCRAFT")).toBeNull();
  });
});

describe('effective location', () => {
  const cat = sampleCatalog();

  it('inherits the bag location', () => {
    const eff = effectiveLocation(cat, cat.items.get(102)!);
    expect(eff.inheritedFrom?.stock_code).toBe('BAG 1118');
    expect(formatLocations(cat, eff.placements)).toBe('B03');
  });

  it("prefers the part's own placement", () => {
    const eff = effectiveLocation(cat, cat.items.get(103)!);
    expect(eff.inheritedFrom).toBeNull();
    expect(formatLocations(cat, eff.placements)).toBe('B07');
  });

  it('lists inheriting parts at the bag location, not parts stored elsewhere', () => {
    const codes = itemsAtLocation(cat, 10).map((e) => e.item.stock_code);
    expect(codes).toEqual(['BAG 1118', 'AN470AD4-5']);
    expect(childrenStoredElsewhere(cat, cat.items.get(101)!).map((i) => i.stock_code)).toEqual(['LP4-3']);
  });

  it('shows split quantities', () => {
    const split = sampleCatalog({
      placements: [placement(1000, 101, 10), placement(1001, 103, 11, 100), placement(1003, 103, 10, 85), placement(1002, 200, 12)],
    });
    expect(formatLocations(split, effectiveLocation(split, split.items.get(103)!).placements)).toBe('B07 (100); B03 (85)');
    expect(splitMismatch(split, split.items.get(103)!)).toBe(false); // 225 - 40 consumed = 185
  });
});

describe('remaining', () => {
  const cat = sampleCatalog();

  it('subtracts consumption for counted parts', () => {
    expect(remaining(cat, cat.items.get(103)!)).toBe(185);
  });

  it('never tracks parts sold by weight', () => {
    expect(remaining(cat, cat.items.get(102)!)).toBeNull();
  });
});

describe('CSV export', () => {
  it('includes every item with its effective location', () => {
    const rows = csvRows(buildCsv(sampleCatalog()));
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.kit === 'EMP' && r.stock_code === 'AN470AD4-5')).toMatchObject({
      subkit: '14 EMP HARDWARE', bag: 'BAG 1118', type: 'part', description: 'RIVET (LB)', qty: '0.11', unit: 'lb',
      received: '', consumed: '', remaining: '', status: 'expected', locations: 'B03', location_inherited_from: 'BAG 1118',
    });
    expect(rows.find((r) => r.stock_code === 'LP4-3')).toMatchObject({ qty: '225', consumed: '40', remaining: '185', locations: 'B07' });
    expect(rows.find((r) => r.kit === 'FUSE')).toMatchObject({ stock_code: 'AN470AD4-5', qty: '0.24', locations: 'S1-B', subkit: '', bag: '' });
  });

  it('exports what arrived, the shortfall, location descriptions and photos', () => {
    const cat = sampleCatalog();
    const lp = [...cat.items.values()].find((i) => i.stock_code === 'LP4-3')!;
    Object.assign(lp, { qty_received: 200, status: 'backordered', photo_key: crypto.randomUUID() });
    const b07 = [...cat.locations.values()].find((l) => l.code === 'B07')!;
    b07.description = 'Drawer 7 left';
    const row = csvRows(buildCsv(cat)).find((r) => r.stock_code === 'LP4-3')!;
    expect(row).toMatchObject({
      qty: '225', received: '200', short: '25', consumed: '40', remaining: '160', status: 'backordered',
      location_descriptions: 'B07: Drawer 7 left', has_photo: 'yes',
    });
  });
});

/** Naive CSV parsing: fine for test data without commas or quotes in cells. */
function csvRows(csv: string) {
  const [head, ...lines] = csv.trim().split('\r\n').map((l) => l.split(','));
  return lines.map((cells) => Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ''])));
}

describe('received counts', () => {
  it('counts remaining from what arrived, and reports received for the export', () => {
    const cat = sampleCatalog();
    const lp = [...cat.items.values()].find((i) => i.stock_code === 'LP4-3')!;
    expect(remaining(cat, lp)).toBe(185);
    expect(receivedQty(lp)).toBeNull();
    lp.status = 'received';
    expect(receivedQty(lp)).toBe(225);
    lp.qty_received = 100;
    expect(remaining(cat, lp)).toBe(60);
    expect(receivedQty(lp)).toBe(100);
    lp.qty_received = null;
    lp.status = 'missing';
    expect(receivedQty(lp)).toBe(0);
  });
});

describe('location grids', () => {
  it('makes a shelf of numbered rows and lettered columns', () => {
    const g = gridLocations({ type: 'shelf', prefix: 'S2-', describe: 'Shelf 2', rows: 5, cols: 4, start: 1 });
    expect(g).toHaveLength(20);
    expect(g.slice(0, 5).map((l) => l.code)).toEqual(['S2-1A', 'S2-1B', 'S2-1C', 'S2-1D', 'S2-2A']);
    expect(g[19]).toMatchObject({ code: 'S2-5D', description: 'Shelf 2, 5D' });
  });

  it('makes padded bins when there are no columns, and can start part way', () => {
    expect(gridLocations({ type: 'bin', prefix: 'b', describe: '', rows: 3, cols: 1, start: 21 }).map((l) => [l.code, l.description]))
      .toEqual([['B21', null], ['B22', null], ['B23', null]]);
    expect(gridLocations({ type: 'bin', prefix: 'B', describe: '', rows: 2, cols: 0, start: 1 }).map((l) => l.code)).toEqual(['B01', 'B02']);
    expect(gridLocations({ type: 'bin', prefix: 'RB-', describe: '', rows: 4, cols: 8, start: 1 }).map((l) => l.code).slice(0, 2)).toEqual(['RB-1A', 'RB-1B']);
  });

  it('refuses empty or oversized grids', () => {
    expect(gridLocations({ type: 'shelf', prefix: 'S1-', describe: '', rows: 0, cols: 4, start: 1 })).toEqual([]);
    expect(gridLocations({ type: 'bin', prefix: 'B', describe: '', rows: 501, cols: 1, start: 1 })).toEqual([]);
  });

  it('suggests the next unused unit and a matching description', () => {
    expect(defaultPrefix('shelf', ['S1-1A', 'S1-1B', 'B01'])).toBe('S2-');
    expect(defaultPrefix('rack', [])).toBe('RACK-1-');
    expect(describePrefix('shelf', 'S2-')).toBe('Shelf 2');
    expect(describePrefix('rack', 'RACK-3-')).toBe('Rack 3');
    expect(describePrefix('bin', 'B')).toBe('');
  });
});

describe('changelog', () => {
  const sample = '# Changelog\n\nIntro.\n\n## 12 · 2026-10-03\n- Two\n- Three\n\n## 1–10 · 2026-09-01\n- First\n';

  it('reads versions, dates and changes, newest first', () => {
    const r = parseChangelog(sample);
    expect(r.map((x) => [x.version, x.number, x.date])).toEqual([['12', 12, '2026-10-03'], ['1–10', 10, '2026-09-01']]);
    expect(r[0].changes).toEqual(['Two', 'Three']);
  });

  it('lists what is new since the version a device last ran', () => {
    const r = parseChangelog(sample);
    expect(newSince(r, 10, 12).map((x) => x.version)).toEqual(['12']);
    expect(newSince(r, 12, 12)).toEqual([]);
  });

  it('parses the real CHANGELOG.md', () => {
    const r = parseChangelog(changelogText);
    expect(r.length).toBeGreaterThan(5);
    expect(r.every((x) => x.changes.length > 0)).toBe(true);
    const headings = changelogText.split('\n').filter((l) => l.startsWith('## ')).length;
    expect(r).toHaveLength(headings);
  });
});
