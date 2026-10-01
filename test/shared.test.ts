import { describe, expect, it } from 'vitest';
import {
  buildCsv, childrenStoredElsewhere, effectiveLocation, formatLocations, itemsAtLocation, remaining, splitMismatch,
} from '../shared/inventory';
import { defaultPrefix, describePrefix, gridLocations } from '../shared/locationGrid';
import { normalizeLocationCode, toSearchKey } from '../shared/normalize';
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
    const csv = buildCsv(sampleCatalog());
    const lines = csv.trim().split('\r\n');
    expect(lines[0]).toMatch(/^kit,subkit,bag,type,stock_code/);
    expect(lines).toHaveLength(6);
    expect(csv).toContain('EMP,14 EMP HARDWARE,BAG 1118,part,AN470AD4-5,RIVET (LB),0.11,lb,,,expected,,B03,BAG 1118');
    expect(csv).toContain('EMP,14 EMP HARDWARE,BAG 1118,part,LP4-3,,225,ea,40,185,expected,,B07,');
    expect(csv).toContain('FUSE,,,part,AN470AD4-5,,0.24,lb,,,expected,,S1-B,');
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
