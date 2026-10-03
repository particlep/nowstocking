import { useState } from 'preact/hooks';
import { itemsAtLocation } from '../../shared/inventory';
import { defaultPrefix, describePrefix, gridLocations, MAX_GRID } from '../../shared/locationGrid';
import { normalizeLocationCode } from '../../shared/normalize';
import { LOCATION_TYPES, type LocationType } from '../../shared/schema';
import { Page } from '../components/chrome';
import { createLocation, createLocations, guessLocationType } from '../data/actions';
import { commit, deleteOp } from '../data/mutate';
import type { Location } from '../../shared/schema';
import { catalog } from '../data/store';

export function LocationsPage() {
  const cat = catalog.value;
  const locations = [...cat.locations.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const [code, setCode] = useState('');
  const [type, setType] = useState<LocationType | null>(null);
  const [desc, setDesc] = useState('');
  const norm = normalizeLocationCode(code);
  const exists = norm && cat.locationsByCode.has(norm);
  const effectiveType = type ?? (norm ? guessLocationType(norm) : 'bin');
  const [mode, setMode] = useState<'one' | 'grid'>('one');

  return (
    <Page title="Locations" back actions={<a class="btn small" href="/labels">Labels</a>}>
      <div class="seg" role="group" aria-label="How many">
        <button class={mode === 'one' ? 'on' : ''} aria-pressed={mode === 'one'} onClick={() => setMode('one')}>One location</button>
        <button class={mode === 'grid' ? 'on' : ''} aria-pressed={mode === 'grid'} onClick={() => setMode('grid')}>Several at once</button>
      </div>
      {mode === 'grid' ? <GridForm /> : <div class="card stack">
        <div class="row">
          <label class="field grow"><span>Code</span>
            <input class="input" placeholder="B01, S1-A, CRATE-1" autoCapitalize="characters" autoCorrect="off" value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field"><span>Type</span>
            <select class="input" value={effectiveType} onChange={(e) => setType((e.target as HTMLSelectElement).value as LocationType)}>
              {LOCATION_TYPES.map((t) => <option value={t}>{t}</option>)}
            </select>
          </label>
        </div>
        <label class="field"><span>Description (optional)</span>
          <input class="input" placeholder="Top shelf, left side" value={desc} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} />
        </label>
        {exists && <p class="small" style={{ color: 'var(--bad)' }}>{norm} already exists.</p>}
        <button
          class="btn primary"
          disabled={!norm || !!exists}
          onClick={async () => { await createLocation(norm, effectiveType, desc.trim() || null); setCode(''); setDesc(''); setType(null); }}
        >Add location</button>
        <p class="small muted">Bins B01, B02…; shelves S1-A (unit 1, top level); large parts CRATE-1, RACK-1.</p>
      </div>}
      {locations.length > 0 && <LocationList locations={locations} />}
    </Page>
  );
}

/** Rows (numbers) × columns (letters) of one type, e.g. a shelf unit S2-1A … S2-5D. */
function GridForm() {
  const cat = catalog.value;
  const codes = [...cat.locationsByCode.keys()];
  const [type, setType] = useState<LocationType>('shelf');
  const [prefix, setPrefix] = useState(() => defaultPrefix('shelf', codes));
  const [describe, setDescribe] = useState<string | null>(null); // null: follows the prefix
  const [rows, setRows] = useState('5');
  const [cols, setCols] = useState('4');
  const [start, setStart] = useState('1');
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<number | null>(null);

  const desc = describe ?? describePrefix(type, prefix);
  const nRows = Number(rows) || 0;
  const nCols = Number(cols) || 0;
  const all = gridLocations({ type, prefix, describe: desc, rows: nRows, cols: nCols, start: Number(start) || 1 });
  const fresh = all.filter((l) => !cat.locationsByCode.has(l.code));
  const tooMany = nRows * Math.max(nCols, 1) > MAX_GRID;
  const gridCols = Math.max(Math.min(nCols, 26), 1);

  const changeType = (t: LocationType) => {
    setType(t);
    setPrefix(defaultPrefix(t, codes));
    setDescribe(null);
    if (t === 'bin') { setRows('20'); setCols('1'); } else if (t === 'shelf') { setRows('5'); setCols('4'); }
  };
  const num = (set: (v: string) => void) => (e: Event) => set((e.target as HTMLInputElement).value.replace(/\D/g, ''));

  return (
    <div class="card stack">
      <div class="row">
        <label class="field grow"><span>Code prefix</span>
          <input class="input" placeholder="S2-" autoCapitalize="characters" autoCorrect="off" value={prefix}
            onInput={(e) => { setPrefix((e.target as HTMLInputElement).value); setAdded(null); }} />
        </label>
        <label class="field"><span>Type</span>
          <select class="input" value={type} onChange={(e) => changeType((e.target as HTMLSelectElement).value as LocationType)}>
            {LOCATION_TYPES.map((t) => <option value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
        <label class="field"><span>Rows</span>
          <input class="input" inputMode="numeric" value={rows} onInput={num(setRows)} />
        </label>
        <label class="field"><span>Columns</span>
          <input class="input" inputMode="numeric" value={cols} onInput={num(setCols)} />
        </label>
        <label class="field"><span>First row</span>
          <input class="input" inputMode="numeric" value={start} onInput={num(setStart)} />
        </label>
      </div>
      <label class="field"><span>Description (optional)</span>
        <input class="input" placeholder="Shelf 2" value={desc} onInput={(e) => setDescribe((e.target as HTMLInputElement).value)} />
      </label>
      <p class="small muted" style={{ margin: '4px 4px 0' }}>
        Rows are numbered 1, 2, 3… and columns lettered A, B, C…. Use 1 column for rows only, like bins B01, B02.
        Each description is this text plus the slot, e.g. "{desc || 'Shelf 2'}, 1A".
      </p>

      {tooMany && <p class="small" style={{ color: 'var(--bad)' }}>That's more than {MAX_GRID} locations. Make the grid smaller.</p>}
      {all.length > 0 && (
        <>
          <div class="section-title" style={{ margin: '8px 4px 0' }}>
            Preview · {fresh.length} new{all.length > fresh.length ? ` · ${all.length - fresh.length} already exist` : ''}
          </div>
          <div style={{ overflow: 'auto', maxHeight: '260px', paddingBottom: '4px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, max-content)`, gap: '6px', width: 'max-content' }}>
              {all.map((l) => (
                <span class="tag sm" title={l.description ?? undefined}
                  style={{ fontSize: '15px', padding: '4px 7px', ...(cat.locationsByCode.has(l.code) ? { opacity: 0.35, textDecoration: 'line-through' } : {}) }}>{l.code}</span>
              ))}
            </div>
          </div>
          {gridCols > 4 && <p class="meta" style={{ margin: '0 4px' }}>Scroll sideways to see every column.</p>}
          {all[0].description && <p class="small muted" style={{ margin: '4px' }}>{all[0].code}: {all[0].description}</p>}
        </>
      )}
      {added !== null && <p class="banner ok">Added {added} location{added === 1 ? '' : 's'}. Print their labels from Labels.</p>}
      <button
        class="btn primary"
        disabled={!fresh.length || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await createLocations(fresh.map((l) => ({ code: l.code, type, description: l.description })));
            setAdded(fresh.length);
            // Ready for the next unit: S1- becomes S2-.
            setPrefix(defaultPrefix(type, [...codes, ...fresh.map((l) => l.code)]));
            setDescribe(null);
          } finally { setBusy(false); }
        }}
      >{fresh.length ? `Add ${fresh.length} location${fresh.length === 1 ? '' : 's'}` : 'Nothing new to add'}</button>
    </div>
  );
}

/** Every location, with a delete button on the empty ones, and a select mode to delete several at once. */
function LocationList({ locations }: { locations: Location[] }) {
  const cat = catalog.value;
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  // Anything stored here, directly or inside a bag that's here, keeps the location from being deleted.
  const stored = (id: number) => itemsAtLocation(cat, id).length;
  const empty = locations.filter((l) => stored(l.id) === 0);
  const chosen = locations.filter((l) => picked.has(l.id) && stored(l.id) === 0);

  const remove = async (locs: Location[]) => {
    const label = locs.length === 1 ? `Delete location ${locs[0].code}` : `Delete ${locs.length} locations`;
    if (!confirm(locs.length === 1 ? `Delete ${locs[0].code}?` : `Delete ${locs.length} empty locations?`)) return;
    await commit(label, locs.map((l) => deleteOp('locations', l.id)));
    setPicked(new Set());
    setSelecting(false);
  };
  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setPicked(next);
  };

  return (
    <>
      <div class="row" style={{ margin: '18px 4px 0' }}>
        <div class="section-title grow" style={{ margin: 0 }}>{locations.length} location{locations.length === 1 ? '' : 's'}</div>
        {selecting ? (
          <>
            <button class="btn small" onClick={() => setPicked(picked.size >= empty.length ? new Set() : new Set(empty.map((l) => l.id)))}>
              {picked.size >= empty.length && empty.length ? 'Select none' : `Select all empty (${empty.length})`}
            </button>
            <button class="btn small" onClick={() => { setSelecting(false); setPicked(new Set()); }}>Cancel</button>
          </>
        ) : (
          <button class="btn small" disabled={!empty.length} onClick={() => setSelecting(true)}>Select</button>
        )}
      </div>
      <div class="list">
        {locations.map((l) => {
          const n = itemsAtLocation(cat, l.id).filter((e) => e.item.item_type === 'part').length;
          const isEmpty = stored(l.id) === 0;
          const body = (
            <>
              <span style={{ minWidth: '84px' }}><span class="tag sm">{l.code}</span></span>
              <span class="grow small muted">{l.type}{l.description ? ` · ${l.description}` : ''}</span>
              <span class="small muted">{isEmpty ? 'Empty' : `${n} part${n === 1 ? '' : 's'}`}</span>
            </>
          );
          if (selecting) {
            return (
              <label class="list-item row" style={{ opacity: isEmpty ? 1 : 0.5 }}>
                <input
                  type="checkbox" class="check" disabled={!isEmpty} checked={picked.has(l.id)} onChange={() => toggle(l.id)}
                  aria-label={isEmpty ? `Select ${l.code}` : `${l.code} has parts and can't be deleted`}
                />
                {body}
              </label>
            );
          }
          return (
            <div class="list-item row">
              <a class="row grow" style={{ color: 'inherit', textDecoration: 'none', minWidth: 0 }} href={`/loc/${encodeURIComponent(l.code)}`}>{body}</a>
              {isEmpty && (
                <button class="btn small danger" aria-label={`Delete ${l.code}`} onClick={() => void remove([l])}>Delete</button>
              )}
            </div>
          );
        })}
      </div>
      {selecting && (
        <div class="action-bar">
          <button class="btn danger block" disabled={!chosen.length} onClick={() => void remove(chosen)}>
            {chosen.length ? `Delete ${chosen.length} location${chosen.length === 1 ? '' : 's'}` : 'Select empty locations to delete'}
          </button>
          <p class="meta center" style={{ margin: 0 }}>Locations with parts in them can't be deleted. Move the parts first.</p>
        </div>
      )}
    </>
  );
}
