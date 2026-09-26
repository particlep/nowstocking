import { Page } from '../components/chrome';

const LINKS = [
  { href: '/receive', title: 'Receiving', desc: 'Check a kit against its packing list' },
  { href: '/import', title: 'Import packing list', desc: 'Read packing list photos into a kit' },
  { href: '/locations', title: 'Locations', desc: 'Bins, shelves, crates' },
  { href: '/labels', title: 'Labels', desc: 'Print QR labels on Avery 5160 / 5163' },
  { href: '/item/new', title: 'Add item', desc: 'A part that is not on a packing list' },
  { href: '/settings', title: 'Settings', desc: 'Sync status, CSV export' },
];

export function MorePage() {
  return (
    <Page title="More">
      <div class="list">
        {LINKS.map((l) => (
          <a class="list-item" href={l.href}>
            <div style={{ fontWeight: 600 }}>{l.title}</div>
            <div class="small muted">{l.desc}</div>
          </a>
        ))}
      </div>
    </Page>
  );
}
