import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { api } from '../data/api';
import { Page } from '../components/chrome';
import { ShareFileButton } from '../components/ShareFileButton';
import { db } from '../data/idb';
import {
  lastSyncedAt, me, outbox, pendingCount, rejected, syncError, syncState,
} from '../data/store';
import { fullResync, signIn, sync } from '../data/sync';
import { authMode, current, legal, signOut, wpath } from '../data/workspace';
import { DeleteAccount } from '../components/DeleteAccount';

export function SettingsPage() {
  const { route } = useLocation();
  const state = syncState.value;
  const [busy, setBusy] = useState(false);
  return (
    <Page title="Settings" back>
      {state === 'signin' && (
        <div class="banner bad stack">
          <div>Your sign-in expired. Your {pendingCount.value} pending edit{pendingCount.value === 1 ? ' is' : 's are'} saved on this phone and will upload after you sign in.</div>
          <button class="btn primary" onClick={signIn}>Sign in</button>
        </div>
      )}
      <div class="card stack">
        <div class="row"><span class="grow muted">Status</span><strong>{state}</strong></div>
        <div class="row"><span class="grow muted">Pending edits</span><strong>{pendingCount.value}</strong></div>
        <div class="row"><span class="grow muted">Last synced</span><span>{lastSyncedAt.value ? new Date(lastSyncedAt.value).toLocaleString() : 'never'}</span></div>
        <div class="row"><span class="grow muted">Signed in as</span><span class="small">{me.value}</span></div>
        {syncError.value && <div class="small" style={{ color: 'var(--bad)' }}>{syncError.value}</div>}
        <div class="row wrap">
          <button class="btn" disabled={busy} onClick={async () => { setBusy(true); await sync(); setBusy(false); }}>Sync now</button>
          <button class="btn" disabled={busy} onClick={async () => { setBusy(true); await fullResync(); setBusy(false); }}>Re-download everything</button>
        </div>
      </div>

      {outbox.value.length > 0 && (
        <>
          <div class="section-title">Waiting to upload</div>
          <div class="list">
            {outbox.value.map((e) => (
              <div class="list-item small">{e.mutation.label} <span class="muted">· {new Date(e.mutation.created_at).toLocaleTimeString()}</span></div>
            ))}
          </div>
        </>
      )}

      {rejected.value.length > 0 && (
        <>
          <div class="section-title">Edits the server refused</div>
          <div class="list">
            {rejected.value.map((r) => (
              <div class="list-item small row">
                <span class="grow">
                  {r.mutation.label}
                  <div class="muted">{r.result.error}</div>
                </span>
                <button
                  class="btn small"
                  onClick={async () => {
                    await (await db()).delete('rejected', r.mutation.id);
                    rejected.value = rejected.value.filter((x) => x.mutation.id !== r.mutation.id);
                  }}
                >Dismiss</button>
              </div>
            ))}
          </div>
        </>
      )}

      <UsageCard />

      <div class="section-title">Export</div>
      <ShareFileButton
        label="Export CSV"
        class="btn block"
        make={async () => {
          const res = await fetch(wpath('/export.csv'), { credentials: 'same-origin', redirect: 'manual' });
          if (res.type === 'opaqueredirect' || !res.ok || !(res.headers.get('content-type') ?? '').includes('text/csv')) {
            throw new Error(res.type === 'opaqueredirect' ? 'Sign in again to export.' : 'Export needs a connection.');
          }
          const name = `inventory-${new Date().toISOString().slice(0, 10)}.csv`;
          return new File([await res.blob()], name, { type: 'text/csv' });
        }}
      />
      <p class="small muted">Every item with its effective location. Needs a connection.</p>
      {authMode.value === 'email' && (
        <button class="btn block danger" style={{ marginTop: '24px' }} onClick={async () => { await signOut(); route('/signin', true); }}>
          Sign out
        </button>
      )}

      <div class="section-title">Account</div>
      <DeleteAccount />
      {(legal.value.terms || legal.value.privacy) && (
        <p class="meta center">
          {legal.value.terms && <a href={legal.value.terms} target="_blank" rel="noreferrer">Terms</a>}
          {legal.value.terms && legal.value.privacy && ' · '}
          {legal.value.privacy && <a href={legal.value.privacy} target="_blank" rel="noreferrer">Privacy Policy</a>}
        </p>
      )}
    </Page>
  );
}

function UsageCard() {
  const account = current.value?.account;
  interface Usage {
    month: string; photo_pages: number; limit: number;
    ai: { spent_usd: number; allowance_usd: number | null; allowed: boolean; suspended: boolean; paused_for_everyone: boolean };
  }
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (account) void api<Usage>(`/api/accounts/${account.id}/usage`).then(setUsage).catch(() => {});
  }, [account?.id]);
  if (!usage) return null;
  const ai = usage.ai;
  const pct = ai.allowance_usd ? Math.min(100, (ai.spent_usd / ai.allowance_usd) * 100) : 0;
  return (
    <>
      <div class="section-title">Photo reading</div>
      <div class="card stack">
        <div class="row">
          <span class="grow">{usage.photo_pages} page{usage.photo_pages === 1 ? '' : 's'} read this month</span>
          <strong>{usage.limit ? `of ${usage.limit}` : ''}</strong>
        </div>
        {ai.allowance_usd != null && (
          <>
            <div class="row">
              <span class="grow">Free AI allowance used</span>
              <strong>${ai.spent_usd.toFixed(2)} of ${ai.allowance_usd.toFixed(2)}</strong>
            </div>
            <div class="progress"><div style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--bad)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)' }} /></div>
          </>
        )}
        {ai.allowance_usd == null && ai.spent_usd > 0 && <div class="meta">AI cost so far: ${ai.spent_usd.toFixed(2)}</div>}
        {!ai.allowed && (
          <p class="banner warn small" style={{ margin: 0 }}>
            {ai.suspended ? 'Photo reading is turned off for this workshop.'
              : ai.paused_for_everyone ? 'Photo reading is paused for everyone until next month.'
              : "This workshop's free photo-reading allowance is used up."}{' '}
            Everything else still works.
          </p>
        )}
      </div>
    </>
  );
}
