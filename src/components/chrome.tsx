import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { me, pendingCount, syncState } from '../data/store';
import { current, identity } from '../data/workspace';
import { BackIcon, BoxIcon, ListIcon, LogoMark, MoreIcon, ScanIcon, SearchIcon } from './icons';

/** Everything that isn't a tab. The More screen on phones, the lower half of the sidebar on wide screens. */
const LINKS = [
  { href: '/receive', title: 'Receiving', desc: 'Check a kit against its packing list' },
  { href: '/import', title: 'Import packing list', desc: 'Read packing list photos into a kit' },
  { href: '/locations', title: 'Locations', desc: 'Bins, shelves, crates' },
  { href: '/labels', title: 'Labels', desc: 'Print QR labels on Avery 5160 / 5163' },
  { href: '/item/new', title: 'Add a part', desc: "For parts that aren't on a packing list" },
  { href: '/export', title: 'Export list', desc: 'Every part, quantity and location as a CSV' },
  { href: '/members', title: 'Members', desc: 'Invite people to your workshop' },
  { href: '/settings', title: 'Settings', desc: 'Sync, usage, sign out' },
];

/** The More links, with Admin first for operators. */
export const moreLinks = () =>
  identity.value?.operator ? [{ href: '/admin', title: 'Admin', desc: 'AI usage across all accounts' }, ...LINKS] : LINKS;

export function SyncPill() {
  const state = syncState.value;
  const pending = pendingCount.value;
  const text =
    state === 'signin' ? 'Sign in' :
    state === 'error' ? 'Sync error' :
    state === 'offline' ? (pending ? `Offline · ${pending}` : 'Offline') :
    state === 'syncing' ? 'Syncing' :
    pending ? `${pending} pending` : 'Synced';
  const cls = state === 'idle' && pending ? 'pending' : state;
  return (
    <a class={`sync-pill ${cls}`} href="/settings" aria-label={`Sync status: ${text}`}>
      <span class="dot" />
      {text}
    </a>
  );
}

/**
 * Screen frame. Tab roots get a large title beside the sync pill; pushed screens get
 * an iOS-style back link, with the title (if any) as a large heading under it.
 */
export function Page(props: {
  title?: string;
  back?: boolean | string;
  actions?: ComponentChildren;
  bottom?: ComponentChildren;
  children: ComponentChildren;
}) {
  const backLabel = typeof props.back === 'string' ? props.back : 'Back';
  return (
    <>
      {props.back ? (
        <header class="topbar">
          <button class="back" onClick={() => history.back()}><BackIcon />{backLabel}</button>
          <span class="spacer" />
          <div class="topbar-right">{props.actions}<SyncPill /></div>
        </header>
      ) : (
        <header class="topbar root">
          <h1 class="large-title grow">{props.title}</h1>
          <div class="topbar-right">{props.actions}<SyncPill /></div>
        </header>
      )}
      <main class="page stack">
        {props.back && props.title && <h1 class="large-title">{props.title}</h1>}
        {props.children}
        {props.bottom && <div class="action-bar">{props.bottom}</div>}
      </main>
    </>
  );
}

const TABS = [
  { href: '/', label: 'Search', icon: SearchIcon, match: (p: string) => p === '/' || (p.startsWith('/item') && p !== '/item/new') },
  { href: '/putaway', label: 'Put away', icon: BoxIcon, match: (p: string) => p === '/putaway' },
  { href: '/scan', label: 'Scan', icon: ScanIcon, match: (p: string) => p === '/scan' || p.startsWith('/loc/') },
  { href: '/pick', label: 'Pick', icon: ListIcon, match: (p: string) => p.startsWith('/pick') },
  { href: '/more', label: 'More', icon: MoreIcon, match: () => false },
];

/** Focused task screens hide the tab bar. */
export function hidesTabs(path: string) {
  return path === '/signin' || path === '/signup' || /^\/import\/[^/]+\/row\//.test(path);
}

export function TabBar() {
  const { path } = useLocation();
  if (hidesTabs(path)) return null;
  const anyMatch = TABS.slice(0, 4).some((t) => t.match(path));
  return (
    <nav class="tabbar" aria-label="Main">
      {TABS.map((t) => {
        const active = t.href === '/more' ? !anyMatch : t.match(path);
        const Icon = t.icon;
        if (t.href === '/scan') {
          return (
            <a href={t.href} class={`scan${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}>
              <span class="scan-btn"><Icon /></span>
              {t.label}
            </a>
          );
        }
        return (
          <a href={t.href} class={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
            <Icon stroke-width={active ? 2.2 : 2} />
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}

/**
 * Wide screens (a laptop or a desktop browser): a sidebar with every section, in place of the tab bar and the
 * More screen. CSS shows one or the other.
 */
export function SideNav() {
  const { path } = useLocation();
  if (hidesTabs(path)) return null;
  const cur = current.value;
  const link = (href: string, label: string, active: boolean, icon?: ComponentChildren) => (
    <a href={href} class={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
      {icon}
      {label}
    </a>
  );
  return (
    <nav class="sidenav" aria-label="Main">
      <a class="sidenav-brand" href="/">
        <LogoMark size={32} />
        <span>Now<span style={{ color: 'var(--accent)' }}>Stocking</span></span>
      </a>
      {cur && (
        <a class="sidenav-warehouse" href="/warehouses">
          <span class="meta">Warehouse</span>
          <span class="name">{cur.warehouse.name}</span>
        </a>
      )}
      <div class="sidenav-group">
        {TABS.slice(0, 4).map((t) => {
          const Icon = t.icon;
          return link(t.href, t.label, t.match(path), <Icon />);
        })}
      </div>
      <div class="sidenav-group">
        {moreLinks().map((l) => link(l.href, l.title, path === l.href || (l.href !== '/item/new' && path.startsWith(`${l.href}/`))))}
      </div>
      <div class="sidenav-foot meta">
        <div>{me.value}</div>
        <div>Version {__APP_VERSION__}</div>
      </div>
    </nav>
  );
}
