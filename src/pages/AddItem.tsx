import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { toSearchKey } from '../../shared/normalize';
import type { ItemType, Unit } from '../../shared/schema';
import { Page } from '../components/chrome';
import { itemFields } from '../data/actions';
import { commit, insertOp } from '../data/mutate';
import { catalog, loaded } from '../data/store';

export function AddItemPage() {
  const { route, query } = useLocation();
  const cat = catalog.value;
  const kits = [...cat.kits.values()].sort((a, b) => (a.code === 'MISC' ? -1 : b.code === 'MISC' ? 1 : a.code.localeCompare(b.code)));
  const preParent = query.parent ? cat.items.get(Number(query.parent)) : undefined;
  const misc = kits.find((k) => k.code === 'MISC');

  const [kitId, setKitId] = useState<number>(preParent?.kit_id ?? misc?.id ?? kits[0]?.id ?? 0);
  const [parentId, setParentId] = useState<number | null>(preParent?.id ?? null);
  const [parentQ, setParentQ] = useState('');
  const [type, setType] = useState<ItemType>('part');
  const [code, setCode] = useState('');
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState<Unit>('ea');
  const [notes, setNotes] = useState('');

  if (!loaded.value) return <Page title="Add item" back>{null}</Page>;

  const containers = [...cat.items.values()].filter((i) => i.kit_id === kitId && i.item_type !== 'part');
  const pq = toSearchKey(parentQ);
  const parentMatches = pq ? containers.filter((c) => c.search_key.includes(pq)).slice(0, 8) : [];
  const parent = parentId ? cat.items.get(parentId) : undefined;
  const valid = code.trim() && Number(qty) >= 0 && kitId;

  const save = async () => {
    let maxSort = 0;
    for (const i of cat.items.values()) if (i.kit_id === kitId) maxSort = Math.max(maxSort, i.sort_order);
    const op = insertOp('items', {
      kit_id: kitId, parent_id: parentId, item_type: type, ...itemFields(code),
      description: desc.trim() || null, qty: Number(qty), unit, vans_bin: null,
      status: 'received', source: 'manual', notes: notes.trim() || null, sort_order: maxSort + 1,
    });
    await commit(`Add ${code.trim()}`, [op]);
    route(`/item/${op.id}`, true);
  };

  return (
    <Page title="Add item" back>
      <p class="small muted">For parts that aren't on a packing list: replacements, hardware-store items, and so on.</p>
      <label class="field">
        <span>Kit</span>
        <select class="input" value={kitId} onChange={(e) => { setKitId(Number((e.target as HTMLSelectElement).value)); setParentId(null); }}>
          {kits.map((k) => <option value={k.id}>{k.code} · {k.name}</option>)}
        </select>
      </label>
      <label class="field">
        <span>Inside bag or sub-kit (optional)</span>
        {parent ? (
          <div class="row">
            <strong class="grow">{parent.stock_code}</strong>
            <button class="btn small" onClick={() => setParentId(null)}>Clear</button>
          </div>
        ) : (
          <>
            <input class="input" placeholder="Search bags, e.g. 1118" value={parentQ} onInput={(e) => setParentQ((e.target as HTMLInputElement).value)} />
            {parentMatches.length > 0 && (
              <div class="list">
                {parentMatches.map((c) => (
                  <button class="list-item" onClick={() => { setParentId(c.id); setParentQ(''); }}>{c.stock_code} <span class="muted small">{c.description}</span></button>
                ))}
              </div>
            )}
          </>
        )}
      </label>
      <div class="seg">
        {(['part', 'bag', 'subkit'] as ItemType[]).map((t) => (
          <button class={type === t ? 'on' : ''} onClick={() => setType(t)}>{t === 'subkit' ? 'sub-kit' : t}</button>
        ))}
      </div>
      <label class="field"><span>Stock code</span>
        <input class="input" value={code} autoCapitalize="characters" autoCorrect="off" onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
      </label>
      <label class="field"><span>Description</span>
        <input class="input" value={desc} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row">
        <label class="field grow"><span>Qty</span>
          <input class="input" inputMode="decimal" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} />
        </label>
        <label class="field grow"><span>Unit</span>
          <select class="input" value={unit} onChange={(e) => setUnit((e.target as HTMLSelectElement).value as Unit)}>
            <option value="ea">each</option><option value="lb">lb (by weight)</option>
          </select>
        </label>
      </div>
      <label class="field"><span>Notes</span>
        <input class="input" value={notes} onInput={(e) => setNotes((e.target as HTMLInputElement).value)} />
      </label>
      <button class="btn primary block" disabled={!valid} onClick={save}>Add item</button>
    </Page>
  );
}
