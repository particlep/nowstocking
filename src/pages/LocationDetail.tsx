import { useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { fmtQty, itemsAtLocation } from '../../shared/inventory';
import { normalizeLocationCode } from '../../shared/normalize';
import { LOCATION_TYPES, type Item, type LocationType } from '../../shared/schema';
import { StatusBadge } from '../components/ItemRow';
import { Page } from '../components/chrome';
import { ChevronIcon, PlusIcon } from '../components/icons';
import { createLocation, guessLocationType } from '../data/actions';
import { commit, deleteOp, updateOp } from '../data/mutate';
import { catalog, loaded } from '../data/store';

function PartLine({ item, qty }: { item: Item; qty?: number | null }) {
  return (
    <a class="list-item row" href={`/item/${item.id}`}>
      <span class="grow" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span class="code">{item.stock_code} <StatusBadge status={item.status} /></span>
        {item.description && <span class="desc small">{item.description}</span>}
      </span>
      <span style={{ fontWeight: 600, fontSize: '15px', whiteSpace: 'nowrap' }}>
        {qty != null ? `${fmtQty(qty)} here` : item.item_type === 'part' ? `${fmtQty(item.qty)} ${item.unit}` : ''}
      </span>
      <ChevronIcon class="chev" />
    </a>
  );
}

export function LocationDetailPage() {
  const { params } = useRoute();
  const { route } = useLocation();
  const code = normalizeLocationCode(decodeURIComponent(params.code ?? ''));
  const cat = catalog.value;
  const loc = cat.locationsByCode.get(code);
  const [editing, setEditing] = useState(false);

  if (!loaded.value) return <Page back>{null}</Page>;

  if (!loc) {
    return (
      <Page back>
        <section class="hero">
          <div class="hero-code">{code}</div>
          <div class="hero-meta">This location isn't set up yet.</div>
          <button class="btn primary lg" onClick={() => createLocation(code, guessLocationType(code), null)}>
            <PlusIcon />Create {code}
          </button>
        </section>
      </Page>
    );
  }

  const entries = itemsAtLocation(cat, loc.id);
  const direct = entries.filter((e) => !e.inherited);
  const parts = entries.filter((e) => e.item.item_type === 'part').length;
  const bags = direct.filter((e) => e.item.item_type !== 'part').length;

  return (
    <Page back actions={<button class="btn small" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit'}</button>}>
      <section class="hero">
        <div class="row" style={{ alignItems: 'flex-end', gap: '14px' }}>
          <div class="hero-code">{loc.code}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: '6px' }}>
            <div class="hero-kicker">{loc.type}</div>
            <div class="hero-meta">{parts} part{parts === 1 ? '' : 's'}{bags ? ` · ${bags} bag${bags === 1 ? '' : 's'}` : ''}</div>
            {loc.description && <div class="hero-meta">{loc.description}</div>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
          <a class="btn primary" href={`/putaway?loc=${encodeURIComponent(loc.code)}`}><PlusIcon />Put away here</a>
          <a class="btn ghost-dark" href={`/labels?loc=${encodeURIComponent(loc.code)}`}>Print label</a>
        </div>
      </section>

      {editing && (
        <LocationEditor
          id={loc.id}
          type={loc.type}
          description={loc.description}
          empty={direct.length === 0}
          onDone={(deleted) => { setEditing(false); if (deleted) route('/locations'); }}
        />
      )}

      <div class="section-title">What's here</div>
      {direct.length === 0 ? (
        <p class="muted center">Nothing stored here yet.</p>
      ) : (
        <div class="cards">
          {direct.map(({ item, placement }) => {
            const inside = entries.filter((e) => e.inherited && e.placement.id === placement.id);
            if (item.item_type === 'part') {
              return <div class="list"><PartLine item={item} qty={placement.qty} /></div>;
            }
            return (
              <div class="list">
                <a class="list-head" href={`/item/${item.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <span class="code grow" style={{ fontSize: '15px' }}>{item.stock_code}</span>
                  <span class="meta">{cat.kits.get(item.kit_id)?.code}</span>
                </a>
                {inside.map((e) => <PartLine item={e.item} />)}
                {inside.length === 0 && <div class="list-item meta">Everything in this {item.item_type} is stored elsewhere.</div>}
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}

function LocationEditor(props: {
  id: number; type: LocationType; description: string | null; empty: boolean; onDone: (deleted: boolean) => void;
}) {
  const [type, setType] = useState(props.type);
  const [desc, setDesc] = useState(props.description ?? '');
  return (
    <div class="card stack">
      <label class="field">
        <span>Type</span>
        <select class="input" value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as LocationType)}>
          {LOCATION_TYPES.map((t) => <option value={t}>{t}</option>)}
        </select>
      </label>
      <label class="field">
        <span>Description</span>
        <input class="input" placeholder="Shelf 1, top left" value={desc} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row wrap">
        <button
          class="btn primary"
          onClick={async () => {
            await commit('Edit location', [updateOp('locations', props.id, { type, description: desc.trim() || null })]);
            props.onDone(false);
          }}
        >Save</button>
        <span class="grow" />
        <button
          class="btn danger"
          disabled={!props.empty}
          onClick={async () => {
            if (!confirm('Delete this location?')) return;
            await commit('Delete location', [deleteOp('locations', props.id)]);
            props.onDone(true);
          }}
        >Delete</button>
      </div>
      {!props.empty && <p class="meta">A location can be deleted once it's empty.</p>}
    </div>
  );
}
