import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import {
  ancestors, childrenStoredElsewhere, consumed, effectiveLocation, fmtQty, formatLocations, remaining, splitMismatch,
} from '../../shared/inventory';
import { ITEM_STATUSES, type Item, type Placement } from '../../shared/schema';
import { ItemRow } from '../components/ItemRow';
import { LocationPicker } from '../components/LocationPicker';
import { Page } from '../components/chrome';
import {
  consume, deleteItem, itemFields, moveAll, moveQty, setStatus, storedQty, useParentLocation,
} from '../data/actions';
import { commit, deleteOp, updateOp } from '../data/mutate';
import { catalog, loaded, tables } from '../data/store';
import { api } from '../data/sync';

export function ItemDetailPage() {
  const { params } = useRoute();
  const cat = catalog.value;
  const item = cat.items.get(Number(params.id));
  if (!loaded.value) return <Page title="Item" back>{null}</Page>;
  if (!item) return <Page title="Item" back><p class="muted center">This item no longer exists.</p></Page>;
  return <ItemDetail item={item} />;
}

function ItemDetail({ item }: { item: Item }) {
  const cat = catalog.value;
  const eff = effectiveLocation(cat, item);
  const anc = ancestors(cat, item);
  const kit = cat.kits.get(item.kit_id);
  const children = cat.children.get(item.id) ?? [];
  const [moving, setMoving] = useState(false);

  return (
    <Page title={item.stock_code} back>
      <div>
        <div class="code" style={{ fontSize: '28px' }}>{item.stock_code}</div>
        {item.description && <div class="desc">{item.description}</div>}
        <div class="small muted">
          {kit?.code}
          {anc.map((a) => <> › <a href={`/item/${a.id}`}>{a.stock_code}</a></>)}
          {item.vans_bin && <> · Van's bin {item.vans_bin}</>}
        </div>
      </div>

      <div class="card stack">
        <div class="row">
          <div class="grow">
            <div class="small muted">Location</div>
            {eff.placements.length
              ? <div class="loc" style={{ fontSize: '30px', whiteSpace: 'normal' }}>{formatLocations(cat, eff.placements)}</div>
              : <div class="loc none">No location</div>}
            {eff.inheritedFrom && <div class="small muted">From {eff.inheritedFrom.stock_code}</div>}
          </div>
          <button class="btn primary" onClick={() => setMoving(!moving)}>{moving ? 'Cancel' : 'Move'}</button>
        </div>
        {splitMismatch(cat, item) && (
          <div class="banner warn small">
            Split quantities add up to {fmtQty((cat.placementsByItem.get(item.id) ?? []).reduce((s, p) => s + (p.qty ?? 0), 0))},
            but {fmtQty(storedQty(cat, item))} {item.unit} should be on hand.
          </div>
        )}
        {!eff.inheritedFrom && eff.placements.length > 0 && anc.some((a) => cat.placementsByItem.get(a.id)?.length) && (
          <button class="btn small" onClick={() => useParentLocation(cat, item)}>Use bag location instead</button>
        )}
        {moving && <MovePanel item={item} placements={eff.placements} onDone={() => setMoving(false)} />}
      </div>

      <div class="section-title">Status</div>
      <div class="seg">
        {ITEM_STATUSES.map((s) => (
          <button class={item.status === s ? 'on' : ''} onClick={() => setStatus(cat, item, s)}>{s}</button>
        ))}
      </div>
      {item.item_type !== 'part' && <p class="small muted">Sets every item inside this {item.item_type}.</p>}

      {item.item_type === 'part' && <QuantityCard item={item} />}

      <NotesCard item={item} />

      {children.length > 0 && (
        <>
          <div class="section-title">Inside this {item.item_type}</div>
          <div class="list">{children.map((c) => <ItemRow item={c} />)}</div>
        </>
      )}

      <EditCard item={item} />
      <History item={item} />
    </Page>
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
      <div class="small muted">Move to:</div>
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
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');

  if (rem == null) {
    return (
      <div class="card">
        <div class="small muted">Quantity</div>
        <div class="code">{fmtQty(item.qty)} lb</div>
        <div class="small muted">Sold by weight. Consumed and remaining aren't tracked.</div>
      </div>
    );
  }
  const n = Number(qty);
  return (
    <div class="card stack">
      <div class="row">
        <div class="grow"><div class="small muted">Shipped</div><div class="code">{fmtQty(item.qty)}</div></div>
        <div class="grow"><div class="small muted">Consumed</div><div class="code">{fmtQty(consumed(cat, item))}</div></div>
        <div class="grow"><div class="small muted">Remaining</div><div class="code" style={{ color: rem < 0 ? 'var(--bad)' : undefined }}>{fmtQty(rem)}</div></div>
      </div>
      <div class="row">
        <input class="input" style={{ width: '90px' }} inputMode="decimal" placeholder="Qty" value={qty} onInput={(e) => setQty((e.target as HTMLInputElement).value)} />
        <input class="input grow" placeholder="Where used (optional), e.g. 08-03" value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      </div>
      <button
        class="btn primary"
        disabled={!(n > 0)}
        onClick={async () => { await consume(item, n, null, note.trim() || null); setQty(''); setNote(''); }}
      >Log consumed</button>
      {log.length > 0 && (
        <div class="list">
          {log.map((c) => (
            <div class="list-item row small">
              <span class="grow">
                <strong>{fmtQty(c.qty)}</strong>{' '}
                {c.note ?? pickListLabel(c.pick_list_id)}
                <span class="muted"> · {new Date(c.updated_at).toLocaleDateString()}</span>
              </span>
              <button class="btn small danger" onClick={() => commit(`Remove consumption of ${item.stock_code}`, [deleteOp('consumptions', c.id)])}>Undo</button>
            </div>
          ))}
        </div>
      )}
    </div>
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
  if (created) return 'Created';
  return <><strong>{c.field}</strong>: {c.old_value ?? '—'} → {c.new_value ?? '—'}</>;
}

function History({ item }: { item: Item }) {
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => {
    setErr(null);
    api<{ changes: Change[] }>(`/api/history/items/${item.id}`)
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
