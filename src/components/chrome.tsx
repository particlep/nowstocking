import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { pendingCount, syncState } from '../data/store';
import { BackIcon, BoxIcon, ListIcon, MoreIcon, ScanIcon, SearchIcon } from './icons';

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
        <header class="topbar" style={{ paddingLeft: '16px' }}>
          <h1 class="large-title grow">{props.title}</h1>
          <div class="topbar-right" style={{ paddingRight: 0 }}>{props.actions}<SyncPill /></div>
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
  { href: '/', label: 'Search', icon: SearchIcon, match: (p: string) => p === '/' || p.startsWith('/item') },
  { href: '/putaway', label: 'Put away', icon: BoxIcon, match: (p: string) => p === '/putaway' },
  { href: '/scan', label: 'Scan', icon: ScanIcon, match: (p: string) => p === '/scan' || p.startsWith('/loc/') },
  { href: '/pick', label: 'Pick', icon: ListIcon, match: (p: string) => p.startsWith('/pick') },
  { href: '/more', label: 'More', icon: MoreIcon, match: () => false },
];

/** Focused task screens hide the tab bar. */
export function hidesTabs(path: string) {
  return /^\/import\/[^/]+\/row\//.test(path);
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
