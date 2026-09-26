import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { canManage, type Role } from '../../shared/directory';
import { Page } from '../components/chrome';
import { onRefresh } from '../components/PullToRefresh';
import { api } from '../data/api';
import { authMode, current, refreshIdentity } from '../data/workspace';

interface Member { user_id: string; email: string; role: Role }
interface Invite { email: string; role: Role; invited_by: string; expires_at: string }
interface Data { members: Member[]; invites: Invite[]; me: string; role: Role }

const json = (body: unknown, method = 'POST'): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** People in the open warehouse's account: invite, change roles, remove, leave. */
export function MembersPage() {
  const { route } = useLocation();
  const account = current.value?.account;
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [note, setNote] = useState<string | null>(null);

  const load = () =>
    account && api<Data>(`/api/accounts/${account.id}/members`).then(setData).catch((e) => setError(e.message ?? 'Members need a connection.'));
  useEffect(() => { void load(); return onRefresh(() => void load()); }, [account?.id]);

  if (!account) return <Page title="Members" back><p class="muted center">Loading…</p></Page>;

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const manage = data ? canManage(data.role) : false;

  return (
    <Page title="Members" back>
      <p class="muted" style={{ margin: 0 }}>Everyone here can open every warehouse in {account.name}.</p>

      {manage && (
        <form class="card stack" onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await api<{ emailed: boolean }>(`/api/accounts/${account.id}/invites`, json({ email: email.trim(), role }));
            setNote(r.emailed ? `Invite sent to ${email.trim()}.` : `${email.trim()} can now sign in to join.`);
            setEmail('');
          });
        }}>
          <strong>Invite someone</strong>
          <input class="input" type="email" inputMode="email" autoCapitalize="off" placeholder="partner@example.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-label="Email to invite" />
          <div class="seg">
            <button type="button" class={role === 'member' ? 'on' : ''} onClick={() => setRole('member')}>Member</button>
            <button type="button" class={role === 'admin' ? 'on' : ''} onClick={() => setRole('admin')}>Admin</button>
          </div>
          <button class="btn primary" type="submit" disabled={!email.includes('@')}>Send invite</button>
          <p class="meta" style={{ margin: 0 }}>
            They join when they sign in with that email.
            {authMode.value === 'access' && ' They also need to be allowed in your Cloudflare Access policy.'}
            {' '}Admins can invite people and manage warehouses.
          </p>
        </form>
      )}
      {note && <p class="banner ok">{note}</p>}
      {error && <p class="banner bad">{error}</p>}

      {data && (
        <>
          <div class="section-title">Members · {data.members.length}</div>
          <div class="list">
            {data.members.map((m) => {
              const self = m.user_id === data.me;
              const canRemove = self || data.role === 'owner' || (data.role === 'admin' && m.role === 'member');
              return (
                <div class="list-item stack" style={{ gap: '8px' }}>
                  <div class="row">
                    <span class="grow" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{m.email}{self && <span class="meta"> (you)</span>}</span>
                    {data.role === 'owner' ? (
                      <select
                        class="input" style={{ width: 'auto', minHeight: '40px', padding: '6px 10px' }} value={m.role} aria-label={`Role for ${m.email}`}
                        onChange={(e) => run(() => api(`/api/accounts/${account.id}/members/${m.user_id}`, json({ role: (e.target as HTMLSelectElement).value }, 'PATCH')))}
                      >
                        <option value="owner">Owner</option><option value="admin">Admin</option><option value="member">Member</option>
                      </select>
                    ) : <span class="badge">{m.role}</span>}
                  </div>
                  {canRemove && (
                    <button
                      class="btn small danger" style={{ alignSelf: 'flex-end' }}
                      onClick={() => {
                        if (!confirm(self ? `Leave ${account.name}? You'll lose access to its warehouses.` : `Remove ${m.email} from ${account.name}?`)) return;
                        void run(async () => {
                          await api(`/api/accounts/${account.id}/members/${m.user_id}`, { method: 'DELETE' });
                          if (self) { await refreshIdentity(); route('/', true); }
                        });
                      }}
                    >{self ? 'Leave account' : 'Remove'}</button>
                  )}
                </div>
              );
            })}
          </div>

          {data.invites.length > 0 && (
            <>
              <div class="section-title">Invited · {data.invites.length}</div>
              <div class="list">
                {data.invites.map((i) => (
                  <div class="list-item row">
                    <span class="grow" style={{ overflowWrap: 'anywhere' }}>{i.email} <span class="meta">· {i.role}</span></span>
                    {manage && (
                      <button class="btn small" onClick={() => run(() => api(`/api/accounts/${account.id}/invites/${encodeURIComponent(i.email)}`, { method: 'DELETE' }))}>Cancel</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Page>
  );
}
