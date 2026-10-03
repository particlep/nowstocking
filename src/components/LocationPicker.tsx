import { useState } from 'preact/hooks';
import { normalizeLocationCode } from '../../shared/normalize';
import { createLocation, guessLocationType } from '../data/actions';
import { catalog } from '../data/store';
import { searchLocations } from '../lib/search';

/** Type-to-filter location list, with "create" when the code doesn't exist yet. */
export function LocationPicker({ onPick, exclude = [] }: { onPick: (locationId: number) => void; exclude?: number[] }) {
  const [q, setQ] = useState('');
  const cat = catalog.value;
  const list = searchLocations(cat, q).filter((l) => !exclude.includes(l.id)).slice(0, 30);
  // Offer to create only what looks like a code (B03, S2-1A), not a description search like "Shelf 1, 2".
  const code = /^[A-Za-z0-9-]+$/.test(q.trim()) ? normalizeLocationCode(q) : '';
  const exists = code && cat.locationsByCode.has(code);
  return (
    <div class="stack">
      <input
        class="input" type="search" aria-label="Search locations"
        placeholder="Search, e.g. S2-1A or Shelf 2"
        value={q}
        autoCapitalize="characters"
        autoCorrect="off"
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      <div class="list">
        {list.map((l) => (
          <button class="list-item" onClick={() => onPick(l.id)}>
            <span class="tag sm">{l.code}</span> <span class="meta" style={{ marginLeft: '6px' }}>{l.type}{l.description ? ` · ${l.description}` : ''}</span>
          </button>
        ))}
        {code && !exists && (
          <button
            class="list-item"
            onClick={async () => onPick(await createLocation(code, guessLocationType(code), null))}
          >
            + Create location <strong>{code}</strong> <span class="muted small">({guessLocationType(code)})</span>
          </button>
        )}
        {!list.length && !q.trim() && <div class="list-item muted">No locations yet. Type a code to create one.</div>}
        {!list.length && q.trim() && !code && <div class="list-item muted">No locations match "{q.trim()}".</div>}
      </div>
    </div>
  );
}
