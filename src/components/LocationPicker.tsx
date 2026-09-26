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
  const code = normalizeLocationCode(q);
  const exists = code && cat.locationsByCode.has(code);
  return (
    <div class="stack">
      <input
        class="input"
        placeholder="Location code, e.g. B03"
        value={q}
        autoCapitalize="characters"
        autoCorrect="off"
        onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      <div class="list">
        {list.map((l) => (
          <button class="list-item" onClick={() => onPick(l.id)}>
            <span class="loc">{l.code}</span> <span class="muted small">{l.type}{l.description ? ` · ${l.description}` : ''}</span>
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
        {!list.length && !code && <div class="list-item muted">No locations yet. Type a code to create one.</div>}
      </div>
    </div>
  );
}
