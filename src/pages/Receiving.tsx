import { useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { fmtQty } from '../../shared/inventory';
import { PROBLEM_STATUSES, type Item, type ItemStatus } from '../../shared/schema';
import { StatusBadge } from '../components/ItemRow';
import { PhotoButton } from '../components/PhotoButton';
import { openPhoto } from '../components/PhotoViewer';
import { photoUrl } from '../data/photos';
import { Page } from '../components/chrome';
import { CheckIcon, MoreIcon } from '../components/icons';
import { markKitReceived, setReceivedQty, setStatus } from '../data/actions';
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

export function ReceivingKitPage() {
  const { params } = useRoute();
  const cat = catalog.value;
  const kit = [...cat.kits.values()].find((k) => k.code === decodeURIComponent(params.kit ?? ''));
  const [hideDone, setHideDone] = useState(false);
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
  const visible = hideDone ? rows.filter((r) => r.item.status === 'expected') : rows;

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
        <div class="row wrap">
          <label class="row small grow">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone((e.target as HTMLInputElement).checked)} />
            Hide checked
          </label>
          {expected > 0 && (
            <button class="btn small" onClick={() => confirm(`Mark all ${expected} unchecked items received?`) && markKitReceived(cat, kit.id)}>
              Mark rest received
            </button>
          )}
        </div>
      </div>

      <div class="list">
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
                  {item.description}{item.item_type === 'part' ? ` · ${fmtQty(item.qty)} ${item.unit}` : ''}
                  {item.qty_received != null && <strong style={{ color: 'var(--bad)' }}> · {fmtQty(item.qty_received)} of {fmtQty(item.qty)} arrived</strong>}
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
      <button class="btn small primary" disabled={!ok} onClick={() => { void setReceivedQty(item, value); onDone(); }}>Save</button>
    </div>
  );
}
