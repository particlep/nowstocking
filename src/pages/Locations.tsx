import { useState } from 'preact/hooks';
import { itemsAtLocation } from '../../shared/inventory';
import { defaultPrefix, describePrefix, gridLocations, MAX_GRID } from '../../shared/locationGrid';
import { normalizeLocationCode } from '../../shared/normalize';
import { LOCATION_TYPES, type LocationType } from '../../shared/schema';
import { Page } from '../components/chrome';
import { createLocation, createLocations, guessLocationType } from '../data/actions';
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
      {locations.length > 0 && (
        <div class="list">
          {locations.map((l) => {
            const n = itemsAtLocation(cat, l.id).filter((e) => e.item.item_type === 'part').length;
            return (
              <a class="list-item row" href={`/loc/${encodeURIComponent(l.code)}`}>
                <span style={{ minWidth: '84px' }}><span class="tag sm">{l.code}</span></span>
                <span class="grow small muted">{l.type}{l.description ? ` · ${l.description}` : ''}</span>
                <span class="small muted">{n} part{n === 1 ? '' : 's'}</span>
              </a>
            );
          })}
        </div>
      )}
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
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridCols}, minmax(0, max-content))`, gap: '6px', overflowX: 'auto', maxHeight: '260px', overflowY: 'auto' }}>
            {all.map((l) => (
              <span class="tag sm" title={l.description ?? undefined}
                style={cat.locationsByCode.has(l.code) ? { opacity: 0.35, textDecoration: 'line-through' } : undefined}>{l.code}</span>
            ))}
          </div>
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
