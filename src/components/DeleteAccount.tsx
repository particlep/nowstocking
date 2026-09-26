import { useState } from 'preact/hooks';
import { api } from '../data/api';
import { authMode, identity, signOut } from '../data/workspace';

interface Summary { deletedAccounts: string[]; leftAccounts: string[]; warehousesErased: number; photosDeleted: number }

/** Settings section: permanently delete the signed-in user. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Summary | null>(null);
  const accounts = identity.value?.accounts ?? [];

  if (done) {
    return (
      <div class="banner ok stack" style={{ display: 'block' }}>
        <strong>Your account is deleted.</strong>
        {done.deletedAccounts.length > 0 && <p style={{ margin: '6px 0 0' }}>Erased: {done.deletedAccounts.join(', ')} ({done.warehousesErased} warehouse{done.warehousesErased === 1 ? '' : 's'}, {done.photosDeleted} photo{done.photosDeleted === 1 ? '' : 's'}).</p>}
        {done.leftAccounts.length > 0 && <p style={{ margin: '6px 0 0' }}>Left: {done.leftAccounts.join(', ')}. Your email was removed from their history.</p>}
      </div>
    );
  }

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<Summary>('/api/me/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm }) });
      await signOut(); // clears this phone's copies too
      setDone(r);
      if (authMode.value === 'access') setTimeout(() => window.location.assign('/'), 4000);
    } catch (e) {
      setError(e instanceof TypeError ? 'Deleting your account needs a connection.' : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return <button class="btn block danger" onClick={() => setOpen(true)}>Delete account…</button>;
  }
  return (
    <div class="card stack" style={{ borderColor: 'var(--bad-line)' }}>
      <strong style={{ color: 'var(--bad)' }}>Delete your account</strong>
      <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '15px' }}>
        {accounts.map((a) => (
          <li>
            <strong>{a.name}</strong>:{' '}
            {a.role === 'owner' ? 'erased with all its warehouses and photos if you are its only member; otherwise you leave it' : 'you leave it; its data stays with the others'}
          </li>
        ))}
        <li>Your sign-in and your email are removed. Your email is also removed from shared workshops' change history.</li>
      </ul>
      <p class="meta" style={{ margin: 0 }}>This can't be undone. Download a CSV export first if you want a copy.</p>
      <label class="field">
        <span>Type DELETE to confirm</span>
        <input class="input" autoCapitalize="characters" autoCorrect="off" value={confirm} onInput={(e) => setConfirm((e.target as HTMLInputElement).value)} />
      </label>
      <div class="row">
        <button class="btn danger" style={{ background: 'var(--bad)', color: '#fff', borderColor: 'var(--bad)' }} disabled={busy || confirm !== 'DELETE'} onClick={run}>
          {busy ? 'Deleting…' : 'Delete my account'}
        </button>
        <button class="btn" onClick={() => { setOpen(false); setConfirm(''); setError(null); }}>Cancel</button>
      </div>
      {error && <p class="banner bad small">{error}</p>}
    </div>
  );
}
