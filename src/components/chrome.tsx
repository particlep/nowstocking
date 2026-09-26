import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';
import { pendingCount, syncState } from '../data/store';
import { BoxIcon, ListIcon, MoreIcon, ScanIcon, SearchIcon } from './icons';

export function SyncPill() {
  const state = syncState.value;
  const pending = pendingCount.value;
  const text =
    state === 'signin' ? 'Sign in' :
    state === 'error' ? 'Sync error' :
    state === 'offline' ? (pending ? `Offline · ${pending}` : 'Offline') :
    state === 'syncing' ? 'Syncing' :
    pending ? `${pending} pending` : 'Synced';
  return (
    <a class={`sync-pill ${state}`} href="/settings" aria-label={`Sync status: ${text}`}>
      <span class="dot" />
      {text}
    </a>
  );
}

export function Page(props: { title: string; back?: boolean; actions?: ComponentChildren; children: ComponentChildren }) {
  return (
    <>
      <header class="header">
        {props.back && (
          <button class="back" onClick={() => history.back()} aria-label="Back">‹ Back</button>
        )}
        <h1>{props.title}</h1>
        {props.actions}
        <SyncPill />
      </header>
      <main class="page stack">{props.children}</main>
    </>
  );
}

const TABS = [
  { href: '/', label: 'Search', icon: SearchIcon, match: (p: string) => p === '/' || p.startsWith('/item') || p.startsWith('/loc') },
  { href: '/scan', label: 'Scan', icon: ScanIcon, match: (p: string) => p === '/scan' },
  { href: '/putaway', label: 'Put away', icon: BoxIcon, match: (p: string) => p === '/putaway' },
  { href: '/pick', label: 'Pick lists', icon: ListIcon, match: (p: string) => p.startsWith('/pick') },
  { href: '/more', label: 'More', icon: MoreIcon, match: () => false },
];

export function TabBar() {
  const { path } = useLocation();
  const anyMatch = TABS.slice(0, 4).some((t) => t.match(path));
  return (
    <nav class="tabbar">
      {TABS.map((t) => {
        const active = t.href === '/more' ? !anyMatch : t.match(path);
        const Icon = t.icon;
        return (
          <a href={t.href} class={active ? 'active' : ''}>
            <Icon />
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
