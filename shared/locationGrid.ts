// Many locations at once: rows are numbers, columns are letters. A shelf "S2-" with 5 rows and 4 columns makes
// S2-1A … S2-5D, described "Shelf 2, 1A" … "Shelf 2, 5D".
import type { LocationType } from './schema';

export interface GridSpec {
  type: LocationType;
  prefix: string;
  /** Prepended to each slot's label, e.g. "Shelf 2" makes "Shelf 2, 1A". Blank: no description. */
  describe: string;
  rows: number;
  /** 0 or 1: rows only (B01, B02…). Up to 26 (A–Z). */
  cols: number;
  /** First row number, so a second batch of bins can carry on from B21. */
  start: number;
}

export interface GridLocation {
  code: string;
  description: string | null;
  row: number;
  col: number;
}

export const MAX_GRID = 500;

/** Bins are B01, B02…; everything else is unpadded, unless the numbers run past 9. */
function rowLabel(n: number, spec: GridSpec) {
  const last = spec.start + spec.rows - 1;
  const width = Math.max(String(last).length, spec.type === 'bin' ? 2 : 1);
  return String(n).padStart(width, '0');
}

export function gridLocations(spec: GridSpec): GridLocation[] {
  const rows = Math.max(0, Math.floor(spec.rows));
  const cols = Math.min(26, Math.max(0, Math.floor(spec.cols)));
  if (!rows || rows * Math.max(cols, 1) > MAX_GRID) return [];
  const prefix = spec.prefix.trim().toUpperCase().replace(/\s+/g, '-');
  const describe = spec.describe.trim();
  const out: GridLocation[] = [];
  for (let r = 0; r < rows; r++) {
    const num = rowLabel(spec.start + r, spec);
    for (let c = 0; c < Math.max(cols, 1); c++) {
      const slot = cols > 1 ? `${num}${String.fromCharCode(65 + c)}` : num;
      out.push({ code: prefix + slot, description: describe ? `${describe}, ${slot}` : null, row: r, col: c });
    }
  }
  return out;
}

/** A sensible starting prefix for a type: the next unused unit number for shelves, crates and racks. */
export function defaultPrefix(type: LocationType, existingCodes: string[]): string {
  const next = (re: RegExp) => 1 + Math.max(0, ...existingCodes.map((c) => Number(re.exec(c)?.[1] ?? 0)));
  switch (type) {
    case 'bin': return 'B';
    case 'shelf': return `S${next(/^S(\d+)-/)}-`;
    case 'crate': return `CRATE-${next(/^CRATE-(\d+)/)}-`;
    case 'rack': return `RACK-${next(/^RACK-(\d+)/)}-`;
    default: return '';
  }
}

/** "S2-" → "Shelf 2", "RACK-1-" → "Rack 1". Bins and anything unrecognised get no description. */
export function describePrefix(type: LocationType, prefix: string): string {
  const p = prefix.trim().toUpperCase();
  const m = /^(?:S|CRATE-?|RACK-?)(\d+)-?$/.exec(p);
  if (!m || type === 'bin' || type === 'other') return '';
  return `${type[0].toUpperCase()}${type.slice(1)} ${m[1]}`;
}
