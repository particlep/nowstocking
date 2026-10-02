import { effectiveLocation, fmtQty, onHandQty, remaining } from '../../shared/inventory';
import type { Item, Placement } from '../../shared/schema';
import { photoUrl } from '../data/photos';
import { catalog } from '../data/store';
import { BagIcon } from './icons';

export function StatusBadge({ status }: { status: Item['status'] }) {
  if (status === 'expected') return null;
  return <span class={`badge ${status}`}>{status}</span>;
}

/** Navy placard(s) for where something is. Splits show each location with its quantity. */
export function LocTags({ placements, size }: { placements: Placement[]; size?: 'sm' | 'lg' | 'xl' }) {
  const cat = catalog.value;
  if (!placements.length) return <span class="tag-none">No location</span>;
  return (
    <div class="tags">
      {placements.map((p) => (
        <span class={`tag${size ? ` ${size}` : ''}`}>
          {cat.locations.get(p.location_id)?.code ?? '?'}
          {p.qty != null && <span style={{ fontSize: '0.6em', opacity: 0.8 }}> {fmtQty(p.qty)}</span>}
        </span>
      ))}
    </div>
  );
}

/** Result card: part number, description, kit and bag, and where it is in big type. */
export function ItemRow({ item, indent, onClick, showLocation = true }: {
  item: Item; indent?: boolean; onClick?: () => void; showLocation?: boolean;
}) {
  const cat = catalog.value;
  const eff = effectiveLocation(cat, item);
  const kit = cat.kits.get(item.kit_id);
  const bag = item.parent_id ? cat.items.get(item.parent_id) : undefined;
  const rem = remaining(cat, item);
  const container = item.item_type !== 'part';
  const details = [
    kit?.code,
    bag && bag.item_type === 'bag' ? bag.stock_code : null,
    item.item_type === 'part'
      ? rem != null && rem !== onHandQty(item) ? `${fmtQty(rem)} of ${fmtQty(onHandQty(item))} left` : `${fmtQty(onHandQty(item))} ${item.unit}`
      : `${cat.children.get(item.id)?.length ?? 0} inside`,
  ].filter(Boolean).join(' · ');

  const content = (
    <>
      {item.photo_key ? (
        <img class="thumb" src={photoUrl(item.photo_key, 'thumb')} alt="" loading="lazy" />
      ) : container && (
        <span class="icon-btn" style={{ width: '36px', height: '36px', borderRadius: '10px' }}><BagIcon /></span>
      )}
      <span class="grow" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span class="code" style={{ fontSize: container ? '17px' : '19px' }}>
          {item.stock_code} <StatusBadge status={item.status} />
        </span>
        {item.description && !container && <span class="desc">{item.description}</span>}
        <span class="meta">{details}</span>
      </span>
      {showLocation && <LocTags placements={eff.placements} size={container ? 'sm' : undefined} />}
    </>
  );
  const cls = `item-card${indent ? ' indent' : ''}`;
  if (onClick) return <button class={cls} onClick={onClick}>{content}</button>;
  return <a class={cls} href={`/item/${item.id}`}>{content}</a>;
}
