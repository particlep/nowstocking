import { useEffect, useRef, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import {
  ancestors, childrenStoredElsewhere, consumed, effectiveLocation, fmtQty, remaining, splitMismatch,
} from '../../shared/inventory';
import { ITEM_STATUSES, type Item, type Placement } from '../../shared/schema';
import { ItemRow, LocTags } from '../components/ItemRow';
import { AlertIcon, ArrowIcon, CameraIcon, CheckIcon, UndoIcon } from '../components/icons';
import { openPhoto } from '../components/PhotoViewer';
import { LocationPicker } from '../components/LocationPicker';
import { Page } from '../components/chrome';
import {
  consume, deleteItem, itemFields, moveAll, moveQty, setStatus, storedQty, useParentLocation,
} from '../data/actions';
import { commit, deleteOp, updateOp } from '../data/mutate';
import { catalog, loaded, tables } from '../data/store';
import { api } from '../data/api';
import { photoUrl, removeItemPhoto, setItemPhoto } from '../data/photos';
import { wpath } from '../data/workspace';

export function ItemDetailPage() {
  const { params } = useRoute();
  const cat = catalog.value;
  const item = cat.items.get(Number(params.id));
  if (!loaded.value) return <Page back>{null}</Page>;
  if (!item) return <Page back><p class="muted center">This item no longer exists.</p></Page>;
  return <ItemDetail item={item} />;
}

const STATUS_ON: Record<Item['status'], string> = {
  expected: 'on', received: 'on-ok', missing: 'on-bad', damaged: 'on-bad', backordered: 'on-warn',
};

function ItemDetail({ item }: { item: Item }) {
  const cat = catalog.value;
  const eff = effectiveLocation(cat, item);
  const anc = ancestors(cat, item);
  const kit = cat.kits.get(item.kit_id);
  const children = cat.children.get(item.id) ?? [];
  const [moving, setMoving] = useState(false);

  return (
    <Page back>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <h1 class="code lg" style={{ margin: 0 }}>{item.stock_code}</h1>
        {item.description && <div style={{ fontSize: '17px' }}>{item.description}</div>}
        <div class="meta" style={{ fontSize: '14px' }}>
          {kit?.code}
          {anc.map((a) => <> › <a href={`/item/${a.id}`} style={{ textDecoration: 'none', fontWeight: 500 }}>{a.stock_code}</a></>)}
          {item.vans_bin && <> · Van's bin {item.vans_bin}</>}
        </div>
      </div>

      <PhotoCard item={item} />

      <section class="card stack">
        <div class="row" style={{ alignItems: 'flex-start', gap: '14px' }}>
          <div class="grow" style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-start' }}>
            <div class="section-title" style={{ margin: 0 }}>Stored in</div>
            <LocTags placements={eff.placements} size="lg" />
            {eff.inheritedFrom && <div class="meta">From {eff.inheritedFrom.stock_code}</div>}
          </div>
          <button class="btn" onClick={() => setMoving(!moving)}>{moving ? 'Cancel' : <><ArrowIcon />Move</>}</button>
        </div>
        {splitMismatch(cat, item) && (
          <div class="banner warn small">
            <AlertIcon />
            <span>
              Split quantities add up to {fmtQty((cat.placementsByItem.get(item.id) ?? []).reduce((s, p) => s + (p.qty ?? 0), 0))},
              but {fmtQty(storedQty(cat, item))} {item.unit} should be on hand.
            </span>
          </div>
        )}
        {!eff.inheritedFrom && eff.placements.length > 0 && anc.some((a) => cat.placementsByItem.get(a.id)?.length) && (
          <button class="btn small" onClick={() => useParentLocation(cat, item)}>Use the bag's location instead</button>
        )}
        {moving && <MovePanel item={item} placements={eff.placements} onDone={() => setMoving(false)} />}
      </section>

      <div class="section-title">Status</div>
      <div class="chips" role="group" aria-label="Status">
        {ITEM_STATUSES.map((s) => (
          <button
            class={`chip${item.status === s ? ` ${STATUS_ON[s]}` : ''}`}
            aria-pressed={item.status === s}
            onClick={() => setStatus(cat, item, s)}
          >
            {item.status === s && s !== 'expected' && <CheckIcon />}
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {item.item_type !== 'part' && <p class="meta">Sets every item inside this {item.item_type}.</p>}

      {item.item_type === 'part' && <QuantityCard item={item} />}

      <NotesCard item={item} />

      {children.length > 0 && (
        <>
          <div class="section-title">Inside this {item.item_type}</div>
          <div class="cards">{children.map((c) => <ItemRow item={c} />)}</div>
        </>
      )}

      <EditCard item={item} />
      <History item={item} />
    </Page>
  );
}

/** One photo per part or bag, so it's easy to recognise on the shelf. */
function PhotoCard({ item }: { item: Item }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };
  const picker = (
    <input
      ref={input} type="file" accept="image/*" hidden
      onChange={(e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        (e.target as HTMLInputElement).value = '';
        if (file) void run('Uploading photo…', () => setItemPhoto(item, file));
      }}
    />
  );

  if (!item.photo_key) {
    return (
      <div class="stack">
        {picker}
        <button class="btn block" disabled={!!busy} onClick={() => input.current?.click()}>
          <CameraIcon />{busy ?? 'Add a photo'}
        </button>
        {error && <p class="banner bad small">{error}</p>}
      </div>
    );
  }
  return (
    <div class="stack">
      {picker}
      <button
        type="button"
        onClick={() => openPhoto(photoUrl(item.photo_key!, 'full'), `Photo of ${item.stock_code}`, { code: item.stock_code, detail: item.description ?? undefined })}
        aria-label={`Open the photo of ${item.stock_code} full size`}
        style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'none' }}
      >
        <img class="photo" src={photoUrl(item.photo_key, 'full')} alt={`Photo of ${item.stock_code}`} style={{ height: '220px', objectFit: 'cover' }} />
      </button>
      <div class="row">
        <button class="btn small grow" disabled={!!busy} onClick={() => input.current?.click()}><CameraIcon />{busy ?? 'Replace photo'}</button>
        <button
          class="btn small danger" disabled={!!busy}
          onClick={() => { if (confirm(`Remove the photo of ${item.stock_code}?`)) void run('Removing…', () => removeItemPhoto(item)); }}
        >Remove</button>
      </div>
      {error && <p class="banner bad small">{error}</p>}
    </div>
  );
}

function MovePanel({ item, placements, onDone }: { item: Item; placements: Placement[]; onDone: () => void }) {
  const cat = catalog.value;
  const total = storedQty(cat, item);
  const elsewhere = item.item_type === 'part' ? [] : childrenStoredElsewhere(cat, item);
  const [mode, setMode] = useState<'all' | 'some'>('all');
  const [qty, setQty] = useState('');
  const [fromLoc, setFromLoc] = useState(placements[0]?.location_id ?? 0);
  const [alsoMove, setAlsoMove] = useState(false);
  const from = placements.find((p) => p.location_id === fromLoc);
  const available = from ? from.qty ?? total : 0;
  const n = Number(qty);
  const qtyOk = mode === 'all' || (n > 0 && n < available + 1e-9);

  return (
    <div class="stack">
      {item.item_type === 'part' && placements.length > 0 && total > 0 && (
        <div class="seg">
          <button class={mode === 'all' ? 'on' : ''} onClick={() => setMode('all')}>Move all</button>
          <button class={mode === 'some' ? 'on' : ''} onClick={() => setMode('some')}>Move some (split)</button>
        </div>
      )}
      {mode === 'some' && (
        <div class="row wrap">
          {placements.length > 1 && (
            <select class="input" style={{ width: 'auto' }} value={fromLoc} onChange={(e) => setFromLoc(Number((e.target as HTMLSelectElement).value))}>
              {placements.map((p) => <option value={p.location_id}>from {cat.locations.get(p.location_id)?.code}</option>)}
            </select>
          )}
          <input
            class="input" style={{ width: '120px' }} inputMode="decimal" placeholder="Qty"
            value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)}
          />
          <span class="muted small">of {fmtQty(available)} {item.unit}</span>
        </div>
      )}
      {elsewhere.length > 0 && (
        <label class="row small">
          <input type="checkbox" checked={alsoMove} onChange={(e) => setAlsoMove((e.target as HTMLInputElement).checked)} />
          <span>{elsewhere.length} part{elsewhere.length === 1 ? '' : 's'} from this {item.item_type} {elsewhere.length === 1 ? 'is' : 'are'} stored elsewhere ({elsewhere.map((e) => e.stock_code).join(', ')}). Move them too.</span>
        </label>
      )}
      <div class="section-title" style={{ margin: '4px 0 0' }}>Move to</div>
      <LocationPicker
        exclude={mode === 'all' && placements.length === 1 && !effectiveLocation(cat, item).inheritedFrom ? [placements[0].location_id] : []}
        onPick={async (locId) => {
          if (!qtyOk) return;
          if (mode === 'some' && from) await moveQty(cat, item, from, locId, n);
          else await moveAll(cat, item, locId, alsoMove ? elsewhere : []);
          onDone();
        }}
      />
      {mode === 'some' && !qtyOk && qty && <p class="small banner warn">Enter a quantity between 0 and {fmtQty(available)}.</p>}
    </div>
  );
}

function QuantityCard({ item }: { item: Item }) {
  const cat = catalog.value;
  const rem = remaining(cat, item);
  const log = [...(cat.consumptionsByItem.get(item.id) ?? [])].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');

  if (rem == null) {
    return (
      <section class="card">
        <div class="stat-label">Quantity</div>
        <div class="stat">{fmtQty(item.qty)} lb</div>
        <div class="meta">Sold by weight, so consumed and remaining aren't tracked.</div>
      </section>
    );
  }
  const n = Number(qty);
  const used = consumed(cat, item);
  const step = (d: number) => setQty(String(Math.max(0, (Number(qty) || 0) + d)));
  return (
    <section class="card stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
        <div><div class="stat-label">Shipped</div><div class="stat">{fmtQty(item.qty)}</div></div>
        <div><div class="stat-label">Consumed</div><div class="stat">{fmtQty(used)}</div></div>
        <div><div class="stat-label">Left</div><div class="stat" style={{ color: rem < 0 ? 'var(--bad)' : 'var(--ok)' }}>{fmtQty(rem)}</div></div>
      </div>
      <div class="progress"><div style={{ width: `${Math.min(100, item.qty ? (used / item.qty) * 100 : 0)}%`, background: 'var(--navy)' }} /></div>
      <div class="row">
        <div class="stepper">
          <button type="button" aria-label="Fewer" onClick={() => step(-1)}>−</button>
          <input aria-label="Quantity consumed" inputMode="decimal" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} />
          <button type="button" aria-label="More" onClick={() => step(1)}>+</button>
        </div>
        <button
          class="btn primary grow"
          disabled={!(n > 0)}
          onClick={async () => { await consume(item, n, null, note.trim() || null); setQty('1'); setNote(''); }}
        >Log {n > 0 ? fmtQty(n) : ''} consumed</button>
      </div>
      <input class="input" placeholder="Where used (optional), e.g. 08-03" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      {log.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {log.map((c) => (
            <div class="row small">
              <strong style={{ minWidth: '32px' }}>{fmtQty(c.qty)}</strong>
              <span class="grow">{c.note ?? pickListLabel(c.pick_list_id)}</span>
              <span class="meta">{new Date(c.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
              <button class="btn small" onClick={() => commit(`Remove consumption of ${item.stock_code}`, [deleteOp('consumptions', c.id)])} aria-label="Undo this entry"><UndoIcon /></button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function pickListLabel(id: number | null) {
  if (id == null) return '';
  const pl = tables.value.pick_lists.get(id);
  return pl ? `pick list ${pl.page ?? pl.section}` : '';
}

function NotesCard({ item }: { item: Item }) {
  const [notes, setNotes] = useState(item.notes ?? '');
  useEffect(() => setNotes(item.notes ?? ''), [item.id, item.notes]);
  return (
    <label class="field">
      <span>Notes</span>
      <textarea
        class="input" rows={2} value={notes}
        onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)}
        onBlur={() => {
          const v = notes.trim() || null;
          if (v !== item.notes) void commit(`Notes on ${item.stock_code}`, [updateOp('items', item.id, { notes: v })]);
        }}
      />
    </label>
  );
}

function EditCard({ item }: { item: Item }) {
  const cat = catalog.value;
  const { route } = useLocation();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ stock_code: item.stock_code, description: item.description ?? '', qty: String(item.qty), unit: item.unit, vans_bin: item.vans_bin ?? '' });
  if (!open) return <button class="btn block" onClick={() => setOpen(true)}>Edit details</button>;
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  return (
    <div class="card stack">
      <label class="field"><span>Stock code</span><input class="input" value={f.stock_code} onInput={set('stock_code')} autoCapitalize="characters" /></label>
      <label class="field"><span>Description</span><input class="input" value={f.description} onInput={set('description')} /></label>
      <div class="row">
        <label class="field grow"><span>Qty</span><input class="input" inputMode="decimal" value={f.qty} onInput={set('qty')} /></label>
        <label class="field grow"><span>Unit</span>
          <select class="input" value={f.unit} onChange={set('unit')}><option value="ea">ea</option><option value="lb">lb</option></select>
        </label>
        <label class="field grow"><span>Van's bin</span><input class="input" value={f.vans_bin} onInput={set('vans_bin')} /></label>
      </div>
      <div class="row wrap">
        <button
          class="btn primary"
          disabled={!f.stock_code.trim() || !(Number(f.qty) >= 0)}
          onClick={async () => {
            await commit(`Edit ${item.stock_code}`, [updateOp('items', item.id, {
              ...itemFields(f.stock_code), description: f.description.trim() || null, qty: Number(f.qty),
              unit: f.unit as Item['unit'], vans_bin: f.vans_bin.trim() || null,
            })]);
            setOpen(false);
          }}
        >Save</button>
        <button class="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button
          class="btn danger"
          onClick={async () => {
            const inside = cat.children.get(item.id)?.length ?? 0;
            const msg = item.source === 'import'
              ? `Delete ${item.stock_code}? It came from a packing list import.${inside ? ` Everything inside it goes too.` : ''}`
              : `Delete ${item.stock_code}?${inside ? ' Everything inside it goes too.' : ''}`;
            if (!confirm(msg)) return;
            await deleteItem(cat, item);
            route('/', true);
          }}
        >Delete</button>
      </div>
    </div>
  );
}

interface Change { table_name: string; field: string; old_value: string | null; new_value: string | null; changed_by: string; changed_at: string }

function describeChange(c: Change) {
  const created = c.field === '_created';
  let fields: Record<string, unknown> = {};
  if (created && c.new_value) {
    try { fields = JSON.parse(c.new_value); } catch { /* old format */ }
  }
  if (c.table_name === 'placements') {
    const code = (id: unknown) => catalog.value.locations.get(Number(id))?.code ?? 'a deleted location';
    if (created) return <>Placed at <strong>{code(fields.location_id)}</strong>{fields.qty != null ? ` (${fields.qty})` : ''}</>;
    if (c.field === 'deleted_at') return c.new_value ? 'Removed from a location' : 'Location restored';
    return <>Location {c.field}: {c.old_value ?? 'all'} → {c.new_value ?? 'all'}</>;
  }
  if (c.table_name === 'consumptions') {
    if (created) return <>Consumed <strong>{String(fields.qty)}</strong>{fields.note ? ` (${fields.note})` : ''}</>;
    if (c.field === 'deleted_at') return c.new_value ? 'Consumption undone' : 'Consumption restored';
  }
  if (c.field === 'photo_key') return !c.new_value ? 'Photo removed' : c.old_value ? 'Photo replaced' : 'Photo added';
  if (created) return 'Created';
  return <><strong>{c.field}</strong>: {c.old_value ?? '—'} → {c.new_value ?? '—'}</>;
}

function History({ item }: { item: Item }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    api<{ changes: Change[] }>(wpath(`/history/items/${item.id}`))
      .then((r) => setChanges(r.changes))
      .catch(() => setErr('History needs a connection.'));
  };
  if (!changes) {
    return (
      <div>
        <button class="btn block" onClick={load}>Show change history</button>
        {err && <p class="small muted center">{err}</p>}
      </div>
    );
  }
  return (
    <>
      <div class="section-title">History</div>
      <div class="list">
        {changes.length === 0 && <div class="list-item muted small">No server history yet.</div>}
        {changes.map((c) => (
          <div class="list-item small">
            <div>
              {describeChange(c)}
            </div>
            <div class="muted">{c.changed_by} · {new Date(c.changed_at).toLocaleString()}</div>
          </div>
        ))}
      </div>
    </>
  );
}
