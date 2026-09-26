import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { ItemRow } from '../components/ItemRow';
import { Page } from '../components/chrome';
import { CloseIcon, SearchIcon } from '../components/icons';
import { getMeta, setMeta } from '../data/idb';
import { catalog, loaded } from '../data/store';
import { search } from '../lib/search';

const MAX_RECENT = 12;

export function SearchPage() {
  const [q, setQ] = useState(() => {
    try { return sessionStorage.getItem('q') ?? ''; } catch { return ''; }
  });
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const { route } = useLocation();
  const cat = catalog.value;
  const hits = useMemo(() => search(cat, q), [cat, q]);

  useEffect(() => {
    void getMeta<string[]>('recentSearches', []).then(setRecent);
  }, []);
  useEffect(() => {
    try { sessionStorage.setItem('q', q); } catch { /* private mode */ }
  }, [q]);

  const open = async (id: number) => {
    const term = q.trim();
    if (term) {
      const next = [term, ...recent.filter((r) => r.toUpperCase() !== term.toUpperCase())].slice(0, MAX_RECENT);
      setRecent(next);
      await setMeta('recentSearches', next);
    }
    route(`/item/${id}`);
  };

  return (
    <Page title="Find a part">
      <label class="search">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          inputMode="search"
          aria-label="Part number"
          placeholder="Part or bag number"
          autoCapitalize="characters"
          autoCorrect="off"
          spellcheck={false}
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        {q && (
          <button type="button" class="icon-btn" aria-label="Clear search" onClick={() => { setQ(''); input.current?.focus(); }}>
            <CloseIcon />
          </button>
        )}
      </label>

      {!loaded.value ? null : q.trim().length < 2 ? (
        <>
          {recent.length > 0 && (
            <>
              <div class="section-title">Recent</div>
              <div class="chips">
                {recent.map((r) => (
                  <button class="chip mono" onClick={() => { setQ(r); input.current?.focus(); }}>{r}</button>
                ))}
              </div>
            </>
          )}
          {cat.items.size === 0 && (
            <div class="card stack">
              <strong>No parts yet</strong>
              <span class="muted">Import a packing list to get started, or add parts by hand.</span>
              <div class="row wrap">
                <a class="btn primary" href="/import">Import packing list</a>
                <a class="btn" href="/item/new">Add a part</a>
              </div>
            </div>
          )}
        </>
      ) : hits.length === 0 ? (
        <p class="muted center">No matches for “{q.trim()}”.</p>
      ) : (
        <>
          <div class="section-title">{hits.length === 60 ? '60+ matches' : `${hits.length} match${hits.length === 1 ? '' : 'es'}`}</div>
          <div class="cards">
            {hits.map((h) => (
              <ItemRow key={h.item.id} item={h.item} indent={h.rank === 5} onClick={() => open(h.item.id)} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
