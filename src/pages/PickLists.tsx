import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { effectiveLocation, fmtQty, formatLocations, remaining, type Catalog } from '../../shared/inventory';
import { toSearchKey } from '../../shared/normalize';
import { PROBLEM_STATUSES, type Item, type PickListLine } from '../../shared/schema';
import { StatusBadge } from '../components/ItemRow';
import { Page } from '../components/chrome';
import type { ImportJobSummary } from '../../shared/importTypes';
import { CameraIcon, CheckIcon, ChevronIcon, PlusIcon } from '../components/icons';
import { PhotoUpload } from '../components/PhotoUpload';
import { onRefresh } from '../components/PullToRefresh';
import { api } from '../data/sync';
import { consume } from '../data/actions';
import { commit, deleteOp, insertOp, updateOp } from '../data/mutate';
import { catalog, loaded, tables } from '../data/store';
import { search } from '../lib/search';

const byNatural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function PickListsPage() {
  const { route } = useLocation();
  const lists = [...tables.value.pick_lists.values()].filter((p) => !p.deleted_at)
    .sort((a, b) => byNatural(a.section, b.section) || byNatural(a.page ?? '', b.page ?? ''));
  const lines = [...tables.value.pick_list_lines.values()].filter((l) => !l.deleted_at);
  const [mode, setMode] = useState<'none' | 'photo' | 'manual'>('none');
  const [section, setSection] = useState('');
  const [page, setPage] = useState('');
  const [title, setTitle] = useState('');
  const [jobs, setJobs] = useState<ImportJobSummary[]>([]);

  useEffect(() => {
    const load = () =>
      api<{ jobs: ImportJobSummary[] }>('/api/import/jobs?kind=instructions')
        .then((r) => setJobs(r.jobs.filter((j) => j.status !== 'committed')))
        .catch(() => {});
    void load();
    return onRefresh(load);
  }, []);

  const create = async () => {
    const op = insertOp('pick_lists', { section: section.trim(), page: page.trim() || null, title: title.trim() });
    await commit(`New pick list ${page.trim() || section.trim()}`, [op]);
    route(`/pick/${op.id}`);
  };

  return (
    <Page title="Pick lists">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
        <button class={`btn${mode === 'photo' ? ' primary' : ''}`} onClick={() => setMode(mode === 'photo' ? 'none' : 'photo')}><CameraIcon />From photos</button>
        <button class={`btn${mode === 'manual' ? ' primary' : ''}`} onClick={() => setMode(mode === 'manual' ? 'none' : 'manual')}><PlusIcon />Type it in</button>
      </div>

      {mode === 'photo' && (
        <div class="card">
          <PhotoUpload
            kind="instructions"
            noun="photo"
            startLabel={(n) => `Read ${n || ''} photo${n === 1 ? '' : 's'}`}
            onStarted={(id) => route(`/pick/photos/${id}`)}
            titleField={{ label: 'Title', placeholder: 'Aft deck' }}
          >
            <strong>Pick list from the plans</strong>
            <span class="meta" style={{ fontSize: '14px' }}>
              Take a photo of each instruction page for this step. Every part number on the page is found and
              matched to where it's stored. You review the list before it's made.
            </span>
          </PhotoUpload>
        </div>
      )}

      {mode === 'manual' && (
        <div class="card stack">
          <div class="row">
            <label class="field grow"><span>Section</span><input class="input" inputMode="numeric" placeholder="10" value={section} onInput={(e) => setSection((e.target as HTMLInputElement).value)} /></label>
            <label class="field grow"><span>Page</span><input class="input" placeholder="10-27" value={page} onInput={(e) => setPage((e.target as HTMLInputElement).value)} /></label>
          </div>
          <label class="field"><span>Title</span><input class="input" placeholder="Aft deck" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
          <button class="btn primary" disabled={!section.trim() || !title.trim()} onClick={create}>Create pick list</button>
        </div>
      )}

      {jobs.length > 0 && (
        <>
          <div class="section-title">From photos</div>
          <div class="list">
            {jobs.map((j) => (
              <a class="list-item row" href={`/pick/photos/${j.id}`}>
                <span class="grow">
                  <span style={{ display: 'block', fontWeight: 600 }}>
                    {[j.page_label, j.title].filter(Boolean).join(' · ') || `${j.page_count} photo${j.page_count === 1 ? '' : 's'}`}
                  </span>
                  <span class="meta">
                    {j.status === 'processing' ? 'Reading…' : j.status === 'uploading' ? 'Upload not finished' : j.pages_failed ? 'Some photos failed' : 'Ready to review'}
                  </span>
                </span>
                <ChevronIcon class="chev" />
              </a>
            ))}
          </div>
        </>
      )}

      {lists.length > 0 && <div class="section-title">Your pick lists</div>}
      {lists.length > 0 && (
        <div class="list">
          {lists.map((l) => {
            const mine = lines.filter((x) => x.pick_list_id === l.id);
            const pulled = mine.filter((x) => x.pulled).length;
            return (
              <a class="list-item row" href={`/pick/${l.id}`}>
                <span class="grow">
                  <span class="row" style={{ alignItems: 'baseline', gap: '8px' }}>
                    <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '24px', lineHeight: 1.1 }}>{l.page ?? `Section ${l.section}`}</span>
                    {l.title && <span class="desc">{l.title}</span>}
                  </span>
                  <span class="meta">{mine.length ? `${pulled} of ${mine.length} pulled` : 'No parts yet'}</span>
                </span>
                {mine.length > 0 && pulled === mine.length && <CheckIcon style={{ width: '20px', height: '20px', color: 'var(--ok)' }} />}
                <ChevronIcon class="chev" />
              </a>
            );
          })}
        </div>
      )}
      {lists.length === 0 && jobs.length === 0 && mode === 'none' && (
        <p class="muted center">Make a pick list for each plans page: snap the page, or type the parts in.</p>
      )}
    </Page>
  );
}

interface ResolvedLine {
  line: PickListLine;
  items: Item[];
  problem: string | null;
  sortKey: string;
}

function resolve(cat: Catalog, line: PickListLine): ResolvedLine {
  const items = (cat.itemsBySearchKey.get(line.search_key) ?? []).filter((i) => i.item_type === 'part' || i.item_type === 'bag');
  const placed = items.filter((i) => effectiveLocation(cat, i).placements.length);
  let problem: string | null = null;
  if (!items.length) problem = 'Not in inventory';
  else if (!placed.length) problem = 'No location';
  else if (items.every((i) => PROBLEM_STATUSES.includes(i.status))) problem = items[0].status;
  const codes = placed.flatMap((i) => effectiveLocation(cat, i).placements.map((p) => cat.locations.get(p.location_id)?.code ?? ''));
  codes.sort(byNatural);
  return { line, items, problem, sortKey: codes[0] ?? '' };
}

export function PickListDetailPage() {
  const { params } = useRoute();
  const { route } = useLocation();
  const cat = catalog.value;
  const list = tables.value.pick_lists.get(Number(params.id));
  const [q, setQ] = useState('');
  const [qty, setQty] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const hits = useMemo(() => search(cat, q, 8).filter((h) => h.item.item_type !== 'subkit'), [cat, q]);

  if (!loaded.value) return <Page title="Pick list" back>{null}</Page>;
  if (!list || list.deleted_at) return <Page title="Pick list" back><p class="muted center">Pick list not found.</p></Page>;

  const lines = [...tables.value.pick_list_lines.values()].filter((l) => l.pick_list_id === list.id && !l.deleted_at);
  const resolved = lines.map((l) => resolve(cat, l)).sort((a, b) =>
    a.line.pulled - b.line.pulled ||
    (a.problem ? 0 : 1) - (b.problem ? 0 : 1) ||
    byNatural(a.sortKey, b.sortKey) ||
    a.line.stock_code.localeCompare(b.line.stock_code),
  );

  const addLine = async (stockCode: string) => {
    const n = Number(qty);
    await commit(`Add ${stockCode} to pick list`, [insertOp('pick_list_lines', {
      pick_list_id: list.id, stock_code: stockCode, search_key: toSearchKey(stockCode),
      qty_needed: qty && n > 0 ? n : null, pulled: 0,
    })]);
    setQ('');
    setQty('');
  };

  const attention = resolved.filter((r) => !r.line.pulled && r.problem);
  const toPull = resolved.filter((r) => !r.line.pulled && !r.problem);
  const pulled = resolved.filter((r) => r.line.pulled);

  return (
    <Page
      back="Pick lists"
      actions={
        <>
          <button class="btn small" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>
          <button class="btn small primary" onClick={() => setAdding(!adding)}>{adding ? 'Done' : <><PlusIcon />Add</>}</button>
        </>
      }
    >
      <div class="row" style={{ alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' }}>
        <h1 class="large-title" style={{ fontSize: '44px' }}>{list.page ?? `Section ${list.section}`}</h1>
        {list.title && <span class="subtitle">{list.title}</span>}
      </div>
      {editing && (
        <EditPickList
          id={list.id}
          section={list.section}
          page={list.page}
          title={list.title}
          lineIds={lines.map((l) => l.id)}
          onDone={(deleted) => (deleted ? route('/pick', true) : setEditing(false))}
        />
      )}
      {resolved.length > 0 && (
        <div class="row">
          <div class="progress grow"><div style={{ width: `${(pulled.length / resolved.length) * 100}%` }} /></div>
          <strong class="small">{pulled.length} of {resolved.length} pulled</strong>
        </div>
      )}

      {(adding || resolved.length === 0) && (
        <div class="card stack">
          <div class="row">
            <input class="input grow code-input" style={{ fontSize: '18px' }} placeholder="Part number" autoCapitalize="characters" autoCorrect="off" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            <input class="input" style={{ width: '84px' }} inputMode="decimal" placeholder="Qty" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} />
          </div>
          {q.trim().length >= 2 && (
            <div class="list">
              {[...new Map(hits.map((h) => [h.item.search_key, h.item])).values()].map((it) => (
                <button class="list-item row" onClick={() => addLine(it.stock_code)}>
                  <span class="code grow" style={{ fontSize: '16px' }}>{it.stock_code}</span>
                  <span class="meta">{it.description}</span>
                  <PlusIcon style={{ width: '18px', height: '18px', color: 'var(--accent)' }} />
                </button>
              ))}
              {!cat.itemsBySearchKey.has(toSearchKey(q)) && (
                <button class="list-item" onClick={() => addLine(q.trim().toUpperCase())}>+ Add “{q.trim().toUpperCase()}” anyway</button>
              )}
            </div>
          )}
          {resolved.length === 0 && !q && <p class="meta" style={{ margin: 0 }}>Add the parts this plans page calls for.</p>}
        </div>
      )}

      {attention.length > 0 && (
        <>
          <div class="section-title bad">Needs attention</div>
          <div class="cards">{attention.map((r) => <PickLine r={r} listId={list.id} />)}</div>
        </>
      )}
      {toPull.length > 0 && (
        <>
          <div class="section-title">Pull in this order</div>
          <div class="cards">{toPull.map((r) => <PickLine r={r} listId={list.id} />)}</div>
        </>
      )}
      {pulled.length > 0 && (
        <>
          <div class="section-title">Pulled</div>
          <div class="cards">{pulled.map((r) => <PickLine r={r} listId={list.id} />)}</div>
        </>
      )}

    </Page>
  );
}

function EditPickList(props: {
  id: number; section: string; page: string | null; title: string | null; lineIds: number[]; onDone: (deleted: boolean) => void;
}) {
  const [section, setSection] = useState(props.section);
  const [page, setPage] = useState(props.page ?? '');
  const [title, setTitle] = useState(props.title ?? '');
  return (
    <div class="card stack">
      <div class="row">
        <label class="field grow"><span>Page</span><input class="input" value={page} placeholder="10-27" onInput={(e) => setPage((e.target as HTMLInputElement).value)} /></label>
        <label class="field grow"><span>Section</span><input class="input" value={section} placeholder="10" onInput={(e) => setSection((e.target as HTMLInputElement).value)} /></label>
      </div>
      <label class="field"><span>Title</span><input class="input" value={title} placeholder="Aft deck" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
      <div class="row">
        <button
          class="btn primary"
          disabled={!section.trim() || !title.trim()}
          onClick={async () => {
            await commit('Edit pick list', [updateOp('pick_lists', props.id, { section: section.trim(), page: page.trim() || null, title: title.trim() })]);
            props.onDone(false);
          }}
        >Save</button>
        <span class="grow" />
        <button
          class="btn danger"
          onClick={async () => {
            if (!confirm(`Delete pick list ${props.page ?? props.section}? This doesn't change your inventory.`)) return;
            await commit('Delete pick list', [...props.lineIds.map((id) => deleteOp('pick_list_lines', id)), deleteOp('pick_lists', props.id)]);
            props.onDone(true);
          }}
        >Delete pick list</button>
      </div>
    </div>
  );
}

function PickLine({ r, listId }: { r: ResolvedLine; listId: number }) {
  const cat = catalog.value;
  const { line } = r;
  const pulled = !!line.pulled;
  const [consumedIds, setConsumedIds] = useState<number[]>([]);
  const tone = pulled ? ' done' : r.problem === 'backordered' ? ' warn' : r.problem ? ' problem' : '';
  const single = r.items.length === 1 ? r.items[0] : null;
  return (
    <div class={`item-card${tone}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
      <div class="row" style={{ gap: '12px' }}>
        <input
          type="checkbox" class="check" checked={pulled}
          onChange={() => commit(`${pulled ? 'Unpull' : 'Pulled'} ${line.stock_code}`, [updateOp('pick_list_lines', line.id, { pulled: pulled ? 0 : 1 })])}
          aria-label={`Pulled ${line.stock_code}`}
        />
        <div class="grow">
          <div class="code" style={{ textDecoration: pulled ? 'line-through' : 'none', color: pulled ? 'var(--muted)' : undefined }}>
            {line.stock_code}{line.qty_needed != null && <span class="muted" style={{ fontWeight: 500 }}> ×{fmtQty(line.qty_needed)}</span>}
          </div>
          {single && <div class="meta">{[cat.kits.get(single.kit_id)?.code, single.description].filter(Boolean).join(' · ')}</div>}
        </div>
        {r.problem === 'Not in inventory' || r.problem === 'No location'
          ? <span class="tag-none">{r.problem}</span>
          : r.problem ? <span class={`badge ${r.problem}`}>{r.problem}</span>
          : single && <span class={`tag${pulled ? ' dim sm' : ''}`}>{formatLocations(cat, effectiveLocation(cat, single).placements)}</span>}
      </div>
      {!single && r.items.map((it) => (
        <a class="row small" href={`/item/${it.id}`} style={{ paddingLeft: '38px', color: 'inherit', textDecoration: 'none' }}>
          <span class="grow meta">{cat.kits.get(it.kit_id)?.code}{remaining(cat, it) != null ? ` · ${fmtQty(remaining(cat, it)!)} left` : ''} <StatusBadge status={it.status} /></span>
          <span class={`tag sm${pulled ? ' dim' : ''}`}>{formatLocations(cat, effectiveLocation(cat, it).placements) || '—'}</span>
        </a>
      ))}
      {pulled && line.qty_needed != null && (
        <div class="row wrap" style={{ paddingLeft: '38px' }}>
          {r.items.filter((it) => remaining(cat, it) != null && !consumedIds.includes(it.id)).map((it) => (
            <button
              class="btn small"
              onClick={async () => {
                await consume(it, line.qty_needed!, listId, null);
                setConsumedIds([...consumedIds, it.id]);
              }}
            >Log {fmtQty(line.qty_needed!)} consumed{r.items.length > 1 ? ` from ${cat.kits.get(it.kit_id)?.code}` : ''}</button>
          ))}
        </div>
      )}
      {!pulled && (
        <button class="btn small" style={{ alignSelf: 'flex-end', minHeight: '30px' }} onClick={() => commit(`Remove ${line.stock_code}`, [deleteOp('pick_list_lines', line.id)])}>Remove</button>
      )}
    </div>
  );
}
