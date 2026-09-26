import { useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { fmtQty, itemsAtLocation } from '../../shared/inventory';
import { normalizeLocationCode } from '../../shared/normalize';
import { LOCATION_TYPES, type LocationType } from '../../shared/schema';
import { ItemRow } from '../components/ItemRow';
import { Page } from '../components/chrome';
import { createLocation, guessLocationType } from '../data/actions';
import { commit, deleteOp, updateOp } from '../data/mutate';
import { catalog, loaded } from '../data/store';

export function LocationDetailPage() {
  const { params } = useRoute();
  const { route } = useLocation();
  const code = normalizeLocationCode(decodeURIComponent(params.code ?? ''));
  const cat = catalog.value;
  const loc = cat.locationsByCode.get(code);
  const [editing, setEditing] = useState(false);

  if (!loaded.value) return <Page title={code} back>{null}</Page>;

  if (!loc) {
    return (
      <Page title={code} back>
        <div class="card stack">
          <strong>{code} isn't set up yet.</strong>
          <span class="muted">Create it to start putting parts here.</span>
          <button class="btn primary" onClick={() => createLocation(code, guessLocationType(code), null)}>
            Create {code}
          </button>
        </div>
      </Page>
    );
  }

  const entries = itemsAtLocation(cat, loc.id);
  const direct = entries.filter((e) => !e.inherited);
  const partCount = entries.filter((e) => e.item.item_type === 'part').length;

  return (
    <Page title={loc.code} back>
      <div class="row wrap">
        <div class="grow">
          <div class="loc" style={{ fontSize: '34px' }}>{loc.code}</div>
          <div class="muted small">{loc.type}{loc.description ? ` · ${loc.description}` : ''} · {partCount} part{partCount === 1 ? '' : 's'}</div>
        </div>
        <a class="btn primary" href={`/putaway?loc=${encodeURIComponent(loc.code)}`}>Put away here</a>
      </div>

      {editing ? (
        <LocationEditor
          id={loc.id}
          type={loc.type}
          description={loc.description}
          empty={direct.length === 0}
          onDone={(deleted) => { setEditing(false); if (deleted) route('/locations'); }}
        />
      ) : (
        <div class="row wrap">
          <button class="btn small" onClick={() => setEditing(true)}>Edit</button>
          <a class="btn small" href={`/labels?loc=${encodeURIComponent(loc.code)}`}>Print label</a>
        </div>
      )}

      {direct.length === 0 ? (
        <p class="muted center">Nothing stored here yet.</p>
      ) : (
        direct.map(({ item, placement }) => {
          const inside = entries.filter((e) => e.inherited && e.placement.id === placement.id);
          return (
            <div class="list">
              <ItemRow item={item} showLocation={placement.qty != null} />
              {placement.qty != null && (
                <div class="list-item small muted">{fmtQty(placement.qty)} {item.unit} of this item stored here</div>
              )}
              {inside.map((e) => <ItemRow item={e.item} indent showLocation={false} />)}
            </div>
          );
        })
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
        <input class="input" value={desc} onInput={(e) => setDesc((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row wrap">
        <button
          class="btn primary"
          onClick={async () => {
            await commit('Edit location', [updateOp('locations', props.id, { type, description: desc.trim() || null })]);
            props.onDone(false);
          }}
        >Save</button>
        <button class="btn" onClick={() => props.onDone(false)}>Cancel</button>
        <button
          class="btn danger"
          disabled={!props.empty}
          title={props.empty ? '' : 'Move everything out first'}
          onClick={async () => {
            if (!confirm('Delete this location?')) return;
            await commit('Delete location', [deleteOp('locations', props.id)]);
            props.onDone(true);
          }}
        >Delete</button>
      </div>
      {!props.empty && <p class="small muted">A location can be deleted once it's empty.</p>}
    </div>
  );
}
