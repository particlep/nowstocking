import { effectiveLocation, fmtQty, formatLocations, remaining } from '../../shared/inventory';
import type { Item } from '../../shared/schema';
import { catalog } from '../data/store';

export function StatusBadge({ status }: { status: Item['status'] }) {
  if (status === 'expected') return null;
  return <span class={`badge ${status}`}>{status}</span>;
}

/** Search-result style row: part, description, kit, and effective location in large text. */
export function ItemRow({ item, indent, onClick, showLocation = true }: {
  item: Item; indent?: boolean; onClick?: () => void; showLocation?: boolean;
}) {
  const cat = catalog.value;
  const eff = effectiveLocation(cat, item);
  const loc = formatLocations(cat, eff.placements);
  const kit = cat.kits.get(item.kit_id);
  const rem = remaining(cat, item);
  const content = (
    <div class="row">
      <div class="grow">
        <div class="code">
          {item.stock_code} <StatusBadge status={item.status} />
        </div>
        {item.description && <div class="desc">{item.description}</div>}
        <div class="small muted">
          {kit?.code} · {item.item_type === 'part' ? `${fmtQty(item.qty)} ${item.unit}` : item.item_type}
          {rem != null && item.item_type === 'part' && rem !== item.qty && ` · ${fmtQty(rem)} left`}
        </div>
      </div>
      {showLocation && (loc ? <div class="loc">{loc}</div> : <div class="loc none">No location</div>)}
    </div>
  );
  const cls = `list-item${indent ? ' indent' : ''}`;
  if (onClick) return <button class={cls} onClick={onClick}>{content}</button>;
  return <a class={cls} href={`/item/${item.id}`}>{content}</a>;
}
