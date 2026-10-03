import { useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { effectiveLocation, fmtQty, formatLocations } from '../../shared/inventory';
import { toSearchKey } from '../../shared/normalize';
import { PROBLEM_STATUSES, type Item, type ItemStatus } from '../../shared/schema';
import { StatusBadge } from '../components/ItemRow';
import { PhotoButton } from '../components/PhotoButton';
import { openPhoto } from '../components/PhotoViewer';
import { photoUrl } from '../data/photos';
import { Page } from '../components/chrome';
import { CheckIcon, MoreIcon } from '../components/icons';
import { createLocation, guessLocationType, putAway, setReceivedQty, setStatus } from '../data/actions';
import { LocationPicker } from '../components/LocationPicker';
import { parseLocationLabel, Scanner } from '../components/Scanner';
import { warehouseId } from '../data/workspace';
import { catalog, loaded } from '../data/store';

export function ReceivingListPage() {
  const cat = catalog.value;
  const kits = [...cat.kits.values()].sort((a, b) => a.code.localeCompare(b.code));
  return (
    <Page title="Receiving" back>
      <div class="list">
        {kits.map((k) => {
          const items = [...cat.items.values()].filter((i) => i.kit_id === k.id);
          const done = items.filter((i) => i.status !== 'expected').length;
          const problems = items.filter((i) => PROBLEM_STATUSES.includes(i.status)).length;
          return (
            <a class="list-item" href={`/receive/${encodeURIComponent(k.code)}`}>
              <div class="code">{k.code}</div>
              <div class="desc">{k.name}</div>
              <div class="small muted">
                {items.length ? `${done} of ${items.length} checked` : 'No items'}
                {problems > 0 && <span style={{ color: 'var(--bad)' }}> · {problems} problem{problems === 1 ? '' : 's'}</span>}
              </div>
            </a>
          );
        })}
      </div>
    </Page>
  );
}

type Filter = 'all' | 'todo' | 'received' | 'problems';
const FILTERS: [Filter, string][] = [['all', 'All'], ['todo', 'To check'], ['received', 'Received'], ['problems', 'Problems']];
const FILTER: Record<Filter, (i: Item) => boolean> = {
  all: () => true,
  todo: (i) => i.status === 'expected',
  received: (i) => i.status === 'received',
  problems: (i) => PROBLEM_STATUSES.includes(i.status),
};

export function ReceivingKitPage() {
  const { params } = useRoute();
  const cat = catalog.value;
  const kit = [...cat.kits.values()].find((k) => k.code === decodeURIComponent(params.kit ?? ''));
  const [show, setShow] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  if (!loaded.value) return <Page title="Receiving" back>{null}</Page>;
  if (!kit) return <Page title="Receiving" back><p class="muted center">Kit not found.</p></Page>;

  // Packing-list order, depth-first.
  const rows: { item: Item; depth: number }[] = [];
  const walk = (parentId: number | null, depth: number) => {
    for (const it of cat.children.get(parentId) ?? []) {
      if (it.kit_id !== kit.id) continue;
      rows.push({ item: it, depth });
      walk(it.id, depth + 1);
    }
  };
  walk(null, 0);
  const problems = rows.filter((r) => PROBLEM_STATUSES.includes(r.item.status));
  const expected = rows.filter((r) => r.item.status === 'expected').length;
  const counts = Object.fromEntries(FILTERS.map(([f]) => [f, rows.filter((r) => FILTER[f](r.item)).length])) as Record<Filter, number>;
  const key = toSearchKey(q);
  const text = q.trim().toLowerCase();
  const matches = (i: Item) => i.search_key.includes(key) || (i.description ?? '').toLowerCase().includes(text);
  // A search for a bag (or sub-kit) shows what's inside it too, so its parts can be received one by one.
  // Rows are in packing-list order, depth-first, so a match's contents are the deeper rows right after it.
  const searched: typeof rows = [];
  let inside = Infinity; // depth of the matched container we're inside, if any
  for (const r of rows) {
    if (inside !== Infinity && r.depth <= inside) inside = Infinity; // left the matched container
    if (!q.trim() || inside < r.depth || matches(r.item)) {
      searched.push(r);
      if (q.trim() && inside === Infinity && r.item.item_type !== 'part') inside = r.depth;
    }
  }
  const visible = searched.filter((r) => FILTER[show](r.item));

  const mark = (item: Item, s: ItemStatus) => {
    setOpen(null);
    void setStatus(catalog.value, item, s);
  };

  return (
    <Page title={`Receive ${kit.code}`} back>
      <div class="card stack">
        <div class="row">
          <div class="grow"><div class="small muted">To check</div><div class="code">{expected}</div></div>
          <div class="grow"><div class="small muted">Checked</div><div class="code">{rows.length - expected}</div></div>
          <div class="grow"><div class="small muted">Problems</div><div class="code" style={{ color: problems.length ? 'var(--bad)' : undefined }}>{problems.length}</div></div>
        </div>
        {problems.length > 0 && (
          <div class="list">
            {problems.map(({ item }) => (
              <a class="list-item row" href={`/item/${item.id}`}>
                <span class="grow"><strong>{item.stock_code}</strong> <span class="muted small">{item.description}</span></span>
                <StatusBadge status={item.status} />
              </a>
            ))}
          </div>
        )}
      </div>

      <input
        class="input" type="search" placeholder="Part number or description" aria-label="Search this kit"
        autoCapitalize="characters" autoCorrect="off" spellcheck={false}
        value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)}
      />
      <div class="chips" role="group" aria-label="Show">
        {FILTERS.map(([f, label]) => (
          <button class={`chip${show === f ? ' on' : ''}`} aria-pressed={show === f} onClick={() => setShow(f)}>{label} · {counts[f]}</button>
        ))}
      </div>
      {visible.length === 0 && <p class="muted center small">{q.trim() ? `Nothing matches "${q.trim()}"` : 'Nothing here'}{show !== 'all' ? ` under ${FILTERS.find(([f]) => f === show)![1]}` : ''}.</p>}

      <div class="list" hidden={!visible.length}>
        {visible.map(({ item, depth }) => (
          <div class="list-item" style={{ paddingLeft: `${14 + depth * 18}px` }}>
            <div class="row">
              {item.photo_key && (
                <button
                  type="button" style={{ padding: 0, border: 0, background: 'none' }} aria-label={`Open the photo of ${item.stock_code}`}
                  onClick={() => openPhoto(photoUrl(item.photo_key!, 'full'), `Photo of ${item.stock_code}`, { code: item.stock_code, detail: item.description ?? undefined })}
                ><img class="thumb" src={photoUrl(item.photo_key, 'thumb')} alt="" loading="lazy" style={{ width: '44px', height: '44px' }} /></button>
              )}
              <div class="grow">
                <div style={{ fontWeight: item.item_type === 'part' ? 600 : 800 }}>
                  {item.stock_code} <StatusBadge status={item.status} />
                </div>
                <div class="small muted">
                  {item.description}{item.item_type === 'part'
                    ? ` · ${fmtQty(item.qty)} ${item.unit}`
                    : ` · ${(cat.children.get(item.id) ?? []).length} inside · ✓ receives them all`}
                  {item.qty_received != null && <strong style={{ color: 'var(--bad)' }}> · {fmtQty(item.qty_received)} of {fmtQty(item.qty)} arrived</strong>}
                  {(() => { const where = formatLocations(cat, effectiveLocation(cat, item).placements); return where ? <> · in <strong>{where}</strong></> : null; })()}
                </div>
              </div>
              {item.status !== 'received' && (
                <button class="icon-btn lg accent" onClick={() => mark(item, 'received')} aria-label={`Mark ${item.stock_code} received`}><CheckIcon /></button>
              )}
              <button class="icon-btn lg" onClick={() => setOpen(open === item.id ? null : item.id)} aria-label={`More statuses for ${item.stock_code}`} aria-expanded={open === item.id}><MoreIcon /></button>
            </div>
            {open === item.id && (
              <>
                <div class="chips" style={{ marginTop: '10px' }}>
                  {(['expected', 'received', ...PROBLEM_STATUSES] as ItemStatus[]).map((s) => (
                    <button class={`chip${item.status === s ? ' on' : ''}`} aria-pressed={item.status === s} onClick={() => mark(item, s)}>{s[0].toUpperCase() + s.slice(1)}</button>
                  ))}
                </div>
                {item.item_type === 'part' && <ReceivedCount item={item} onDone={() => setOpen(null)} />}
                <PutAwayHere item={item} onDone={() => setOpen(null)} />
                <div style={{ marginTop: '10px' }}><PhotoButton item={item} /></div>
              </>
            )}
          </div>
        ))}
      </div>
    </Page>
  );
}

/** For a short shipment: how many of this part actually arrived. */
function ReceivedCount({ item, onDone }: { item: Item; onDone: () => void }) {
  const [n, setN] = useState(String(item.qty_received ?? item.qty));
  const value = Number(n);
  const ok = n.trim() !== '' && value >= 0;
  return (
    <div class="row" style={{ marginTop: '10px' }}>
      <span class="small">Arrived</span>
      <input
        class="input" style={{ width: '90px' }} inputMode="decimal" aria-label={`How many ${item.stock_code} arrived`}
        value={n} onInput={(e) => setN((e.target as HTMLInputElement).value)}
      />
      <span class="small muted grow">of {fmtQty(item.qty)} {item.unit}</span>
      <button class="btn small primary" disabled={!ok} onClick={() => { void setReceivedQty(catalog.value, item, value); onDone(); }}>Save</button>
    </div>
  );
}

/** Put this item (with anything inside it) away while receiving: scan the location's label, or search for it. */
function PutAwayHere({ item, onDone }: { item: Item; onDone: () => void }) {
  const [mode, setMode] = useState<'scan' | 'search' | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const where = formatLocations(catalog.value, effectiveLocation(catalog.value, item).placements);

  const place = async (locationId: number) => {
    await putAway(catalog.value, item, locationId);
    setMode(null);
    onDone();
  };
  const scanned = async (text: string) => {
    const loc = parseLocationLabel(text);
    if (!loc) return;
    if (loc.warehouseId && loc.warehouseId !== warehouseId.value) {
      setWarning(`${loc.code} belongs to a different warehouse.`);
      return;
    }
    setWarning(null);
    const existing = catalog.value.locationsByCode.get(loc.code);
    await place(existing?.id ?? (await createLocation(loc.code, guessLocationType(loc.code), null)));
  };

  return (
    <div class="stack" style={{ marginTop: '10px' }}>
      <div class="row wrap">
        <span class="small grow">{where ? <>Stored in <strong>{where}</strong></> : 'Not put away yet'}</span>
        <button class={`btn small${mode === 'scan' ? ' primary' : ''}`} onClick={() => setMode(mode === 'scan' ? null : 'scan')}>Scan label</button>
        <button class={`btn small${mode === 'search' ? ' primary' : ''}`} onClick={() => setMode(mode === 'search' ? null : 'search')}>Search</button>
      </div>
      {mode === 'scan' && <Scanner onResult={(t) => void scanned(t)} />}
      {mode === 'search' && <LocationPicker onPick={(id) => void place(id)} />}
      {warning && <p class="banner warn small" style={{ margin: 0 }}>{warning}</p>}
    </div>
  );
}
