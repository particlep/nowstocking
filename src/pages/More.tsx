import { Page } from '../components/chrome';
import { ChevronIcon, LogoMark } from '../components/icons';
import { me } from '../data/store';
import { CurrentWarehouseCard } from './Warehouses';

const LINKS = [
  { href: '/receive', title: 'Receiving', desc: 'Check a kit against its packing list' },
  { href: '/import', title: 'Import packing list', desc: 'Read packing list photos into a kit' },
  { href: '/locations', title: 'Locations', desc: 'Bins, shelves, crates' },
  { href: '/labels', title: 'Labels', desc: 'Print QR labels on Avery 5160 / 5163' },
  { href: '/item/new', title: 'Add a part', desc: "For parts that aren't on a packing list" },
  { href: '/settings', title: 'Settings', desc: 'Sync status and CSV export' },
];

export function MorePage() {
  return (
    <Page title="More">
      <CurrentWarehouseCard />
      <div class="list">
        {LINKS.map((l) => (
          <a class="list-item row" href={l.href}>
            <span class="grow">
              <span style={{ display: 'block', fontWeight: 600 }}>{l.title}</span>
              <span class="meta">{l.desc}</span>
            </span>
            <ChevronIcon class="chev" />
          </a>
        ))}
      </div>
      <div class="row" style={{ gap: '12px', marginTop: '28px', justifyContent: 'center' }}>
        <LogoMark size={40} />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '24px', lineHeight: 1 }}>
            Now<span style={{ color: 'var(--accent)' }}>Stocking</span>
          </div>
          <div class="meta">Parts inventory · find it, scan it, pull it</div>
        </div>
      </div>
      <p class="meta center">Signed in as {me.value}</p>
    </Page>
  );
}
