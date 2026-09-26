import type { Catalog } from '../../shared/inventory';
import { toSearchKey } from '../../shared/normalize';
import type { Item } from '../../shared/schema';

export interface PartMatch {
  /** Inventory items with exactly this part number (one per kit it shipped in). */
  exact: Item[];
  /** Close part numbers, for a misread or a parent/child suffix (F-01412 vs F-01412C). */
  suggestions: Item[];
}

/** Edit distance, capped: returns > max as soon as it's exceeded. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

const usable = (i: Item) => i.item_type !== 'subkit';

export function matchPart(cat: Catalog, stockCode: string): PartMatch {
  const key = toSearchKey(stockCode);
  const exact = (cat.itemsBySearchKey.get(key) ?? []).filter(usable);
  if (exact.length || key.length < 4) return { exact, suggestions: [] };

  const scored: { item: Item; score: number }[] = [];
  for (const [k, items] of cat.itemsBySearchKey) {
    if (k.length < 4) continue;
    let score = -1;
    if (k.startsWith(key) || key.startsWith(k)) score = Math.abs(k.length - key.length);
    else if (key.length >= 6) {
      const d = distance(key, k, 1);
      if (d <= 1) score = 1 + d;
    }
    if (score >= 0 && score <= 2) {
      const it = items.find(usable);
      if (it) scored.push({ item: it, score });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.item.stock_code.localeCompare(b.item.stock_code));
  return { exact, suggestions: scored.slice(0, 3).map((s) => s.item) };
}
