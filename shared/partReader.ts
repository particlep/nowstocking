import { toSearchKey } from './normalize';

/** Characters OCR confuses on printed labels, each folded to one stand-in so a misread still finds the part. */
const FOLD: Record<string, string> = { O: '0', Q: '0', D: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6' };
const fold = (key: string) => key.replace(/[OQDILSBZG]/g, (c) => FOLD[c]);

/** The part numbers a scan can snap to: search key -> part number as printed. */
export interface PartIndex {
  codes: Map<string, string>;
  folded: Map<string, string[]>;
}

export function buildPartIndex(parts: Iterable<{ search_key: string; stock_code: string }>): PartIndex {
  const codes = new Map<string, string>();
  const folded = new Map<string, string[]>();
  for (const p of parts) {
    if (!p.search_key || codes.has(p.search_key)) continue;
    codes.set(p.search_key, p.stock_code);
    const f = fold(p.search_key);
    folded.set(f, [...(folded.get(f) ?? []), p.search_key]);
  }
  return { codes, folded };
}

export interface PartRead {
  /** What to type into the field: the part number as the catalog has it, or as read. */
  text: string;
  /** True when it is a part in the catalog; false when it only looks like a part number. */
  known: boolean;
}

/**
 * One edit (change, insert or delete a character) or none. A character added or dropped at the end doesn't count:
 * VA-1407 is a different part from VA-140, not a misread of it.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  if (i >= Math.min(a.length, b.length)) return false;
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * The part number in a line of OCR text. Tries each word and each pair of neighbouring words (OCR splits "F-01406B"
 * into "F- 01406B"), first as read, then with confusable characters folded, then as the start of a word that ran into
 * the next one ("F-01406BQTY4"), then one character off for longer numbers. A match must be the only one. Without a
 * match, returns the longest word that looks like a part number.
 */
export function readPartNumber(line: string, index: PartIndex): PartRead | null {
  const words = line.toUpperCase().split(/[^A-Z0-9-]+/).filter(Boolean);
  const candidates = [...words, ...words.slice(1).map((w, i) => words[i] + w)]
    .map(toSearchKey).filter((k) => k.length >= 3);
  const unique = (keys: string[]) => (new Set(keys).size === 1 ? index.codes.get(keys[0])! : null);

  for (const k of candidates) if (index.codes.has(k)) return { text: index.codes.get(k)!, known: true };
  for (const k of candidates) {
    const hit = unique(index.folded.get(fold(k)) ?? []);
    if (hit) return { text: hit, known: true };
  }
  for (const k of candidates) {
    // The longest catalog part the word starts with, unless the word just carries on its digits (VA-1400 isn't VA-140).
    const f = fold(k);
    let best: string[] = [];
    for (const [fk, keys] of index.folded) {
      if (fk.length < 4 || fk.length >= f.length || !f.startsWith(fk)) continue;
      if (/\d/.test(k[fk.length - 1]) && /\d/.test(k[fk.length])) continue;
      if (!best.length || fk.length > fold(best[0]).length) best = keys;
      else if (fk.length === fold(best[0]).length) best = [...best, ...keys];
    }
    const hit = unique(best);
    if (hit) return { text: hit, known: true };
  }
  for (const k of candidates) {
    if (k.length < 6) continue;
    const f = fold(k);
    const near: string[] = [];
    for (const [fk, keys] of index.folded) if (withinOneEdit(f, fk)) near.push(...keys);
    const hit = unique(near);
    if (hit) return { text: hit, known: true };
  }

  const looksLikePart = words.filter((w) => /\d/.test(w) && /^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(w) && w.length >= 4 && w.length <= 24);
  const best = looksLikePart.sort((a, b) => b.length - a.length)[0];
  return best ? { text: best, known: false } : null;
}
