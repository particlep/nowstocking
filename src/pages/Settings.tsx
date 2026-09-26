import { useState } from 'preact/hooks';
import { Page } from '../components/chrome';
import { ShareFileButton } from '../components/ShareFileButton';
import { db } from '../data/idb';
import {
  lastSyncedAt, me, outbox, pendingCount, rejected, syncError, syncState,
} from '../data/store';
import { fullResync, signIn, sync } from '../data/sync';
import { wpath } from '../data/workspace';

export function SettingsPage() {
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
    </Page>
  );
}
