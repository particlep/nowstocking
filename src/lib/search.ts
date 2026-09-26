import { toSearchKey } from '../../shared/normalize';
import type { Catalog } from '../../shared/inventory';
import type { Item } from '../../shared/schema';

export interface SearchHit {
  item: Item;
  /** Lower is better: 0 exact, 1 prefix, 2 substring, 3 description, 4 fuzzy, 5 inside a matching bag. */
  rank: number;
}

/** Characters of q appear in order in s. Returns a gap score (lower is tighter) or -1. */
function fuzzy(q: string, s: string): number {
  let si = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = s.indexOf(ch, si);
    if (found < 0) return -1;
    if (found > si) gaps += found - si;
    si = found + 1;
  }
  return gaps;
}

/**
 * Rank: exact, then prefix, then substring, then fuzzy. A matching bag pulls in the parts inside it,
 * so "1118" finds BAG 1118 and its contents. Parts only (not sub-kits) unless a bag or sub-kit matches.
 */
export function search(cat: Catalog, query: string, limit = 60): SearchHit[] {
  const q = toSearchKey(query);
  if (q.length < 2) return [];
  const scored: { item: Item; rank: number; tie: number }[] = [];
  const descQ = query.trim().toUpperCase();

  for (const item of cat.items.values()) {
    const k = item.search_key;
    let rank = -1;
    let tie = k.length;
    if (k === q) rank = 0;
    else if (k.startsWith(q)) rank = 1;
    else if (k.includes(q)) rank = 2;
    else if (descQ.length >= 3 && item.description?.toUpperCase().includes(descQ)) rank = 3;
    else if (q.length >= 3) {
      const g = fuzzy(q, k);
      if (g >= 0 && g <= Math.max(2, k.length - q.length)) {
        rank = 4;
        tie = g * 100 + k.length;
      }
    }
    if (rank >= 0) scored.push({ item, rank, tie });
  }
  scored.sort((a, b) => a.rank - b.rank || a.tie - b.tie || a.item.stock_code.localeCompare(b.item.stock_code));

  const out: SearchHit[] = [];
  const seen = new Set<number>();
  for (const s of scored) {
    if (out.length >= limit) break;
    if (seen.has(s.item.id)) continue;
    seen.add(s.item.id);
    out.push({ item: s.item, rank: s.rank });
    if (s.item.item_type === 'bag' && s.rank <= 2) {
      for (const child of cat.children.get(s.item.id) ?? []) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        out.push({ item: child, rank: 5 });
      }
    }
  }
  return out;
}

export function searchLocations(cat: Catalog, query: string) {
  const q = toSearchKey(query);
  const all = [...cat.locations.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  if (!q) return all;
  return all.filter((l) => toSearchKey(l.code).includes(q) || l.description?.toUpperCase().includes(query.trim().toUpperCase()));
}
