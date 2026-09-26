import { useMemo, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { effectiveLocation, fmtQty, formatLocations, remaining, type Catalog } from '../../shared/inventory';
import { toSearchKey } from '../../shared/normalize';
import { PROBLEM_STATUSES, type Item, type PickListLine } from '../../shared/schema';
import { StatusBadge } from '../components/ItemRow';
import { Page } from '../components/chrome';
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
  const [section, setSection] = useState('');
  const [page, setPage] = useState('');
  const [title, setTitle] = useState('');

  const create = async () => {
    const op = insertOp('pick_lists', { section: section.trim(), page: page.trim() || null, title: title.trim() || null });
    await commit(`New pick list ${page.trim() || section.trim()}`, [op]);
    route(`/pick/${op.id}`);
  };

  return (
    <Page title="Pick lists">
      <div class="card stack">
        <div class="row">
          <label class="field grow"><span>Section</span><input class="input" inputMode="numeric" placeholder="08" value={section} onInput={(e) => setSection((e.target as HTMLInputElement).value)} /></label>
          <label class="field grow"><span>Page</span><input class="input" placeholder="08-03" value={page} onInput={(e) => setPage((e.target as HTMLInputElement).value)} /></label>
        </div>
        <label class="field"><span>Title (optional)</span><input class="input" placeholder="Horizontal stabilizer spars" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
        <button class="btn primary" disabled={!section.trim()} onClick={create}>Create pick list</button>
      </div>
      {lists.length > 0 && (
        <div class="list">
          {lists.map((l) => {
            const mine = lines.filter((x) => x.pick_list_id === l.id);
            const pulled = mine.filter((x) => x.pulled).length;
            return (
              <a class="list-item" href={`/pick/${l.id}`}>
                <div class="code">{l.page ?? `Section ${l.section}`}</div>
                {l.title && <div class="desc">{l.title}</div>}
                <div class="small muted">{mine.length ? `${pulled} of ${mine.length} pulled` : 'No lines yet'}</div>
              </a>
            );
          })}
        </div>
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

  return (
    <Page title={list.page ?? `Section ${list.section}`} back>
      {list.title && <div class="desc">{list.title}</div>}
      <div class="card stack">
        <div class="row">
          <input class="input grow" placeholder="Add part number" autoCapitalize="characters" autoCorrect="off" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <input class="input" style={{ width: '80px' }} inputMode="decimal" placeholder="Qty" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} />
        </div>
        {q.trim().length >= 2 && (
          <div class="list">
            {[...new Map(hits.map((h) => [h.item.search_key, h.item])).values()].map((it) => (
              <button class="list-item" onClick={() => addLine(it.stock_code)}>
                <strong>{it.stock_code}</strong> <span class="small muted">{it.description}</span>
              </button>
            ))}
            {!cat.itemsBySearchKey.has(toSearchKey(q)) && (
              <button class="list-item" onClick={() => addLine(q.trim().toUpperCase())}>+ Add “{q.trim().toUpperCase()}” anyway</button>
            )}
          </div>
        )}
      </div>

      {resolved.length === 0 && <p class="muted center">Add the parts this plans page calls for.</p>}
      <div class="list">
        {resolved.map((r) => <PickLine r={r} listId={list.id} />)}
      </div>

      <button
        class="btn danger block"
        onClick={async () => {
          if (!confirm('Delete this pick list?')) return;
          await commit('Delete pick list', [...lines.map((l) => deleteOp('pick_list_lines', l.id)), deleteOp('pick_lists', list.id)]);
          route('/pick', true);
        }}
      >Delete pick list</button>
    </Page>
  );
}

function PickLine({ r, listId }: { r: ResolvedLine; listId: number }) {
  const cat = catalog.value;
  const { line } = r;
  const pulled = !!line.pulled;
  const [consumedIds, setConsumedIds] = useState<number[]>([]);
  return (
    <div class="list-item" style={{ opacity: pulled ? 0.6 : 1 }}>
      <div class="row">
        <input
          type="checkbox" style={{ width: '26px', height: '26px' }} checked={pulled}
          onChange={() => commit(`${pulled ? 'Unpull' : 'Pulled'} ${line.stock_code}`, [updateOp('pick_list_lines', line.id, { pulled: pulled ? 0 : 1 })])}
          aria-label="Pulled"
        />
        <div class="grow">
          <div class="code" style={{ textDecoration: pulled ? 'line-through' : 'none' }}>
            {line.stock_code}{line.qty_needed != null && <span class="muted"> × {fmtQty(line.qty_needed)}</span>}
          </div>
          {r.problem && <div class="small" style={{ color: 'var(--bad)', fontWeight: 600 }}>{r.problem}</div>}
        </div>
        <button class="btn small" onClick={() => commit(`Remove ${line.stock_code}`, [deleteOp('pick_list_lines', line.id)])} aria-label="Remove line">✕</button>
      </div>
      {r.items.map((it) => {
        const loc = formatLocations(cat, effectiveLocation(cat, it).placements);
        const rem = remaining(cat, it);
        const canConsume = pulled && line.qty_needed != null && rem != null && !consumedIds.includes(it.id);
        return (
          <div class="row small" style={{ marginTop: '6px', paddingLeft: '34px' }}>
            <a class="grow" href={`/item/${it.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <span class="loc" style={{ fontSize: '18px' }}>{loc || '—'}</span>{' '}
              <span class="muted">{cat.kits.get(it.kit_id)?.code}{rem != null ? ` · ${fmtQty(rem)} left` : ''}</span>{' '}
              <StatusBadge status={it.status} />
            </a>
            {canConsume && (
              <button
                class="btn small"
                onClick={async () => {
                  await consume(it, line.qty_needed!, listId, null);
                  setConsumedIds([...consumedIds, it.id]);
                }}
              >Mark {fmtQty(line.qty_needed!)} consumed</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
