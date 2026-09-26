import { useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { Op } from '../../shared/schema';
import { ItemRow } from '../components/ItemRow';
import { LocationPicker } from '../components/LocationPicker';
import { parseLocationCode, Scanner } from '../components/Scanner';
import { Page } from '../components/chrome';
import { createLocation, guessLocationType, putAway, undo } from '../data/actions';
import { catalog } from '../data/store';
import { search } from '../lib/search';

interface Placed { itemId: number; undo: Op[] }

export function PutAwayPage() {
  const { query } = useLocation();
  const cat = catalog.value;
  const [locId, setLocId] = useState<number | null>(() => (query.loc ? cat.locationsByCode.get(query.loc)?.id ?? null : null));
  const [picking, setPicking] = useState<'scan' | 'type'>('scan');
  const [q, setQ] = useState('');
  const [placed, setPlaced] = useState<Placed[]>([]);
  const hits = useMemo(() => search(cat, q, 25), [cat, q]);
  const loc = locId ? cat.locations.get(locId) : undefined;

  const setLocation = async (code: string) => {
    const existing = catalog.value.locationsByCode.get(code);
    const id = existing?.id ?? (await createLocation(code, guessLocationType(code), null));
    setLocId(id);
    setPlaced([]);
  };

  if (!loc) {
    return (
      <Page title="Put away">
        <p class="muted">Scan the location first. Everything you add goes there until you pick a new one.</p>
        <div class="seg">
          <button class={picking === 'scan' ? 'on' : ''} onClick={() => setPicking('scan')}>Scan label</button>
          <button class={picking === 'type' ? 'on' : ''} onClick={() => setPicking('type')}>Type code</button>
        </div>
        {picking === 'scan' ? (
          <Scanner onResult={(t) => { const c = parseLocationCode(t); if (c) void setLocation(c); }} />
        ) : (
          <LocationPicker onPick={(id) => { setLocId(id); setPlaced([]); }} />
        )}
      </Page>
    );
  }

  const last = placed[placed.length - 1];
  return (
    <Page title="Put away">
      <div class="card row">
        <div class="grow">
          <div class="small muted">Putting away into</div>
          <div class="loc" style={{ fontSize: '32px' }}>{loc.code}</div>
        </div>
        <button class="btn" onClick={() => setLocId(null)}>Change</button>
      </div>

      <input
        class="search-input" type="search" placeholder="Part or bag number" autoCapitalize="characters" autoCorrect="off"
        spellcheck={false} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      {hits.length > 0 && (
        <div class="list">
          {hits.map((h) => (
            <ItemRow
              item={h.item}
              indent={h.rank === 5}
              onClick={async () => {
                const u = await putAway(catalog.value, h.item, loc.id);
                setPlaced([...placed, { itemId: h.item.id, undo: u }]);
                setQ('');
              }}
            />
          ))}
        </div>
      )}

      {last && (
        <button
          class="btn block"
          onClick={async () => {
            await undo(`Undo put away`, last.undo);
            setPlaced(placed.slice(0, -1));
          }}
        >
          Undo {cat.items.get(last.itemId)?.stock_code ?? 'last'}
        </button>
      )}

      {placed.length > 0 && (
        <>
          <div class="section-title">Put in {loc.code} this session ({placed.length})</div>
          <div class="list">
            {[...placed].reverse().map((p) => {
              const it = cat.items.get(p.itemId);
              return it ? <ItemRow item={it} /> : null;
            })}
          </div>
        </>
      )}
    </Page>
  );
}
