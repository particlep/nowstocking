import { describe, expect, it } from 'vitest';
import { matchPart } from '../src/lib/matchParts';
import { search } from '../src/lib/search';
import { item, sampleCatalog } from './fixtures';

describe('search', () => {
  const cat = sampleCatalog();

  it('finds a part from a sloppy query and shows it in every kit', () => {
    const hits = search(cat, '470ad45');
    expect(hits.slice(0, 2).map((h) => h.item.id).sort()).toEqual([102, 200]);
    expect(hits[0].rank).toBe(2); // substring of AN470AD45
  });

  it('ranks an exact part number first', () => {
    const hits = search(cat, 'an470ad4-5');
    expect(hits[0].rank).toBe(0);
    expect(hits[0].item.stock_code).toBe('AN470AD4-5');
  });

  it('pulls in the parts inside a matching bag', () => {
    const hits = search(cat, '1118');
    expect(hits[0].item.stock_code).toBe('BAG 1118');
    expect(hits.filter((h) => h.rank === 5).map((h) => h.item.stock_code)).toEqual(['AN470AD4-5', 'LP4-3']);
  });

  it('waits for two characters', () => {
    expect(search(cat, '4')).toEqual([]);
  });

  it('ranks prefix matches above fuzzy ones', () => {
    const hits = search(cat, 'lp43');
    expect(hits[0].item.stock_code).toBe('LP4-3');
  });
});

describe('matching plans part numbers to inventory', () => {
  const cat = sampleCatalog({
    items: [...sampleCatalog().items.values(), item(300, 2, 'F-01412', { item_type: 'part' })],
  });

  it('matches exactly regardless of dashes', () => {
    expect(matchPart(cat, 'an470ad4-5').exact).toHaveLength(2);
  });

  it('suggests a close part number when there is no exact match', () => {
    const m = matchPart(cat, 'F-01412C');
    expect(m.exact).toEqual([]);
    expect(m.suggestions.map((i) => i.stock_code)).toContain('F-01412');
  });
});
