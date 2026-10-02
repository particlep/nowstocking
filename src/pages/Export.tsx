import { buildCsv } from '../../shared/inventory';
import { Page } from '../components/chrome';
import { ShareFileButton } from '../components/ShareFileButton';
import { catalog, loaded } from '../data/store';
import { current } from '../data/workspace';

/** The whole warehouse as a CSV, built on the phone from its offline copy, so it works with no signal. */
export function ExportButton({ label = 'Export CSV', class: cls }: { label?: string; class?: string }) {
  return (
    <ShareFileButton
      label={label}
      class={cls}
      disabled={!loaded.value}
      make={async () => {
        const warehouse = (current.value?.warehouse.name ?? 'inventory').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const name = `${warehouse || 'inventory'}-${new Date().toISOString().slice(0, 10)}.csv`;
        // A byte-order mark so Excel reads the file as UTF-8.
        return new File(['\uFEFF' + buildCsv(catalog.value)], name, { type: 'text/csv' });
      }}
    />
  );
}

const COLUMNS: [string, string][] = [
  ['Kit', 'Kit code and name, and the date it was marked received'],
  ['Packing list', 'Sub-kit and bag each part came in, part number and description'],
  ['Quantities', 'Shipped, received, short, consumed and remaining'],
  ['Status', 'Expected, received, missing, damaged or backordered'],
  ['Locations', 'Where it is, with split quantities and the location descriptions'],
  ['Other', "Van's bin, notes, whether it has a photo, and whether it came from an import"],
];

export function ExportPage() {
  const cat = catalog.value;
  const items = [...cat.items.values()];
  const parts = items.filter((i) => i.item_type === 'part').length;
  return (
    <Page title="Export list" back>
      <div class="card stack">
        <div>
          <div class="section-title" style={{ margin: 0 }}>Warehouse</div>
          <div style={{ fontWeight: 600, fontSize: '19px' }}>{current.value?.warehouse.name}</div>
          <div class="meta">{parts} part{parts === 1 ? '' : 's'} and {items.length - parts} bags and sub-kits in {cat.kits.size} kit{cat.kits.size === 1 ? '' : 's'}</div>
        </div>
        <ExportButton class="btn primary block" />
        <p class="small muted" style={{ margin: 0 }}>A CSV file that opens in Excel, Numbers or Google Sheets. One row per sub-kit, bag and part, in packing-list order. Works offline.</p>
      </div>
      <div class="section-title">What's in it</div>
      <div class="list">
        {COLUMNS.map(([title, desc]) => (
          <div class="list-item">
            <div style={{ fontWeight: 600 }}>{title}</div>
            <div class="meta">{desc}</div>
          </div>
        ))}
      </div>
    </Page>
  );
}
