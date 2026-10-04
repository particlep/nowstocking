import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { effectiveLocation, formatLocations } from '../../shared/inventory';
import type { Op } from '../../shared/schema';
import { LocationPicker } from '../components/LocationPicker';
import { parseLocationLabel, Scanner } from '../components/Scanner';
import { Page } from '../components/chrome';
import { CheckIcon, PlusIcon, SearchIcon, UndoIcon } from '../components/icons';
import { createLocation, guessLocationType, putAway, undo } from '../data/actions';
import { catalog } from '../data/store';
import { warehouseId } from '../data/workspace';
import { search } from '../lib/search';
import { ScanPartButton } from '../components/PartScanner';

interface Placed { itemId: number; undo: Op[]; at: number }

export function PutAwayPage() {
  const { query } = useLocation();
  const cat = catalog.value;
  const [locId, setLocId] = useState<number | null>(() => (query.loc ? cat.locationsByCode.get(query.loc)?.id ?? null : null));
  // Scanning needs a camera; on a computer, start with search.
  const [picking, setPicking] = useState<'scan' | 'type'>(() => (matchMedia('(pointer: fine)').matches ? 'type' : 'scan'));
  const [q, setQ] = useState('');
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [wrongWarehouse, setWrongWarehouse] = useState<string | null>(null);
  const [toastFor, setToastFor] = useState<number | null>(null); // `at` of the placement the undo bar is for
  const hits = useMemo(() => search(cat, q, 25), [cat, q]);
  const loc = locId ? cat.locations.get(locId) : undefined;

  const setLocation = async (code: string) => {
    const existing = catalog.value.locationsByCode.get(code);
    const id = existing?.id ?? (await createLocation(code, guessLocationType(code), null));
    setLocId(id);
    setPlaced([]);
  };

  useEffect(() => {
    if (toastFor == null) return;
    const t = setTimeout(() => setToastFor(null), 2500);
    return () => clearTimeout(t);
  }, [toastFor]);

  if (!loc) {
    return (
      <Page title="Put away">
        <p class="muted" style={{ margin: 0 }}>Scan or search for where you're putting things. Everything you add goes there until you pick a new spot.</p>
        <div class="seg">
          <button class={picking === 'scan' ? 'on' : ''} onClick={() => setPicking('scan')}>Scan label</button>
          <button class={picking === 'type' ? 'on' : ''} onClick={() => setPicking('type')}>Search locations</button>
        </div>
        {picking === 'scan' ? (
          <>
          <Scanner
            onResult={(t) => {
              const loc = parseLocationLabel(t);
              if (!loc) return;
              if (loc.warehouseId && loc.warehouseId !== warehouseId.value) {
                setWrongWarehouse(loc.code);
                return;
              }
              setWrongWarehouse(null);
              void setLocation(loc.code);
            }}
          />
          {wrongWarehouse && <p class="banner warn">{wrongWarehouse} belongs to a different warehouse. Switch warehouses from More first.</p>}
          </>
        ) : (
          <LocationPicker onPick={(id) => { setLocId(id); setPlaced([]); }} />
        )}
      </Page>
    );
  }

  const last = placed[placed.length - 1];
  const lastItem = last ? cat.items.get(last.itemId) : undefined;
  const undoLast = async () => {
    if (!last) return;
    await undo('Undo put away', last.undo);
    setPlaced(placed.slice(0, -1));
    setToastFor(null);
  };
  return (
    <Page title="Put away">
      <section class="card accent-edge row" style={{ gap: '14px', padding: '14px' }}>
        <span class="tag xl">{loc.code}</span>
        <div class="grow">
          <div class="hero-kicker" style={{ color: 'var(--accent)' }}>Putting into</div>
          <div class="meta" style={{ fontSize: '14px' }}>{loc.description ?? loc.type}</div>
        </div>
        <button class="btn" aria-label="Choose a different location" onClick={() => setLocId(null)}>Change</button>
      </section>

      <div class="row">
        <label class="search grow">
          <SearchIcon />
          <input
            type="search" aria-label="Part or bag number" placeholder="Part or bag number" autoCapitalize="characters"
            autoCorrect="off" spellcheck={false} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
        </label>
        <ScanPartButton parts={() => catalog.value.items.values()} onScan={setQ} />
      </div>

      {hits.length > 0 && (
        <div class="cards">
          {hits.map((h) => {
            const where = formatLocations(cat, effectiveLocation(cat, h.item).placements);
            return (
              <button
                class={`item-card${h.rank === 5 ? ' indent' : ''}`}
                onClick={async () => {
                  const u = await putAway(catalog.value, h.item, loc.id);
                  const at = Date.now();
                  setPlaced([...placed, { itemId: h.item.id, undo: u, at }]);
                  setToastFor(at);
                  setQ('');
                }}
              >
                <span class="grow" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span class="code" style={{ fontSize: '17px' }}>{h.item.stock_code}</span>
                  <span class="meta">
                    {[h.item.item_type === 'bag' ? h.item.description : null, cat.kits.get(h.item.kit_id)?.code, where ? `in ${where}` : 'no location yet'].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span class="icon-btn lg accent" aria-hidden="true"><PlusIcon /></span>
              </button>
            );
          })}
        </div>
      )}

      {placed.length > 0 && (
        <>
          <div class="section-title">In {loc.code} this session · {placed.length}</div>
          <div class="list">
            {[...placed].reverse().map((p, i) => {
              const it = cat.items.get(p.itemId);
              if (!it) return null;
              return (
                <div class="list-item row">
                  <CheckIcon style={{ width: '18px', height: '18px', color: 'var(--ok)', flexShrink: 0 }} />
                  <a class="code grow" href={`/item/${it.id}`} style={{ fontSize: '15px', color: 'inherit', textDecoration: 'none' }}>{it.stock_code}</a>
                  <span class="meta">{new Date(p.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                  {i === 0 && <button class="btn small" onClick={undoLast} aria-label={`Undo putting ${it.stock_code} in ${loc.code}`}><UndoIcon />Undo</button>}
                </div>
              );
            })}
          </div>
        </>
      )}

      {last && lastItem && toastFor === last.at && (
        <div class="toast" role="status">
          <span class="grow">{lastItem.stock_code} put in <strong>{loc.code}</strong></span>
          <button class="btn" onClick={undoLast}><UndoIcon />Undo</button>
        </div>
      )}
    </Page>
  );
}
