import { useState } from 'preact/hooks';
import { itemsAtLocation } from '../../shared/inventory';
import { normalizeLocationCode } from '../../shared/normalize';
import { LOCATION_TYPES, type LocationType } from '../../shared/schema';
import { Page } from '../components/chrome';
import { createLocation, guessLocationType } from '../data/actions';
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

  return (
    <Page title="Locations" back actions={<a class="btn small" href="/labels">Labels</a>}>
      <div class="card stack">
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
      </div>
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
