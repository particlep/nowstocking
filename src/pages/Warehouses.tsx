import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { canManage, type AccountInfo } from '../../shared/directory';
import { Page } from '../components/chrome';
import { CheckIcon, ChevronIcon, PlusIcon } from '../components/icons';
import { api } from '../data/api';
import { sync } from '../data/sync';
import { current, identity, openWarehouse, refreshIdentity, warehouseId } from '../data/workspace';

/** Switch, add, rename and archive warehouses. */
export function WarehousesPage() {
  const { route } = useLocation();
  const accounts = identity.value?.accounts ?? [];
  const open = async (id: string) => {
    await openWarehouse(id);
    void sync();
    route('/');
  };
  return (
    <Page title="Warehouses" back>
      <p class="muted" style={{ margin: 0 }}>
        A warehouse is one build or storage space, with its own parts, locations and labels.
      </p>
      {accounts.map((a) => <AccountSection account={a} onOpen={open} />)}
      {!accounts.length && <p class="banner">Connect to the internet once to load your warehouses.</p>}
    </Page>
  );
}

function AccountSection({ account, onOpen }: { account: AccountInfo; onOpen: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const manage = canManage(account.role);

  const add = async () => {
    setError(null);
    try {
      const r = await api<{ id: string }>(`/api/accounts/${account.id}/warehouses`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim() }),
      });
      await refreshIdentity();
      setAdding(false);
      setName('');
      onOpen(r.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <div class="section-title">{account.name} · {account.role}</div>
      <div class="list">
        {account.warehouses.map((w) => (
          <button class="list-item row" onClick={() => onOpen(w.id)} aria-current={w.id === warehouseId.value ? 'true' : undefined}>
            <span class="grow" style={{ fontWeight: 600 }}>{w.name}</span>
            {w.id === warehouseId.value ? <CheckIcon style={{ width: '20px', height: '20px', color: 'var(--ok)' }} /> : <ChevronIcon class="chev" />}
          </button>
        ))}
      </div>
      {manage && !adding && (
        <button class="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(true)}><PlusIcon />New warehouse</button>
      )}
      {adding && (
        <div class="card stack">
          <label class="field"><span>Name</span>
            <input class="input" placeholder="RV-14A, Garage shelves, Boat build…" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <div class="row">
            <button class="btn primary" disabled={!name.trim()} onClick={add}>Create</button>
            <button class="btn" onClick={() => setAdding(false)}>Cancel</button>
          </div>
          {error && <p class="banner bad small">{error}</p>}
        </div>
      )}
    </>
  );
}

/** Rename or archive the open warehouse. */
export function CurrentWarehouseCard() {
  const cur = current.value;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { route } = useLocation();
  if (!cur) return null;
  const manage = canManage(cur.account.role);

  const save = async () => {
    setError(null);
    try {
      await api(`/api/w/${cur.warehouse.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
      await refreshIdentity();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const archive = async () => {
    if (!confirm(`Archive ${cur.warehouse.name}? It disappears from the app. Its data is kept.`)) return;
    setError(null);
    try {
      await api(`/api/w/${cur.warehouse.id}`, { method: 'DELETE' });
      await refreshIdentity();
      route('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section class="card stack">
      <div class="row">
        <div class="grow">
          <div class="section-title" style={{ margin: 0 }}>Warehouse</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '28px', lineHeight: 1.1 }}>{cur.warehouse.name}</div>
          <div class="meta">{cur.account.name}</div>
        </div>
        <a class="btn small" href="/warehouses">Switch</a>
      </div>
      {manage && !editing && (
        <div class="row">
          <button class="btn small" onClick={() => { setName(cur.warehouse.name); setEditing(true); }}>Rename</button>
          {cur.account.role === 'owner' && <button class="btn small danger" onClick={archive}>Archive</button>}
        </div>
      )}
      {editing && (
        <div class="row">
          <input class="input grow" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Warehouse name" />
          <button class="btn primary" disabled={!name.trim()} onClick={save}>Save</button>
        </div>
      )}
      {error && <p class="banner bad small">{error}</p>}
    </section>
  );
}
