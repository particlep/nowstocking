import { useEffect, useState } from 'preact/hooks';
import { Page } from '../components/chrome';
import { onRefresh } from '../components/PullToRefresh';
import { api } from '../data/api';

interface Account {
  id: string; name: string; created_at: string; owner: string | null; members: number; warehouses: number;
  photo_pages_month: number; ai_calls: number; ai_month_usd: number; ai_total_usd: number; last_ai_at: string | null;
  ai_allowance_usd: number | null; allowance_override: boolean; suspended: boolean;
}
interface Overview {
  month: string;
  settings: { allowance_usd: number | null; monthly_cap_usd: number | null };
  totals: { month_usd: number; total_usd: number; month_calls: number; users: number; accounts: number };
  accounts: Account[];
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Operator only: AI spend per account, the monthly cap, and per-account controls. */
export function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'spend' | 'blocked' | 'all'>('spend');

  const load = () => api<Overview>('/api/admin/overview').then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message));
  useEffect(() => { void load(); return onRefresh(() => void load()); }, []);

  const patch = async (id: string, body: object) => {
    try {
      await api(`/api/admin/accounts/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!data) return <Page title="Admin" back>{error ? <p class="banner bad">{error}</p> : <p class="muted center">Loading…</p>}</Page>;

  const cap = data.settings.monthly_cap_usd;
  const capPct = cap ? Math.min(100, (data.totals.month_usd / cap) * 100) : 0;
  const blocked = (a: Account) => a.suspended || (a.ai_allowance_usd != null && a.ai_total_usd >= a.ai_allowance_usd);
  const shown = data.accounts.filter((a) => filter === 'all' || (filter === 'blocked' ? blocked(a) : a.ai_total_usd > 0));

  return (
    <Page title="Admin" back>
      <section class="card stack">
        <div class="row" style={{ alignItems: 'flex-end' }}>
          <div class="grow">
            <div class="stat-label">AI spend in {data.month}</div>
            <div class="stat">{usd(data.totals.month_usd)}</div>
          </div>
          <div class="meta" style={{ textAlign: 'right' }}>
            {cap ? <>cap {usd(cap)}</> : 'no monthly cap'}<br />{data.totals.month_calls} calls
          </div>
        </div>
        {cap != null && (
          <div class="progress"><div style={{ width: `${capPct}%`, background: capPct >= 100 ? 'var(--bad)' : capPct >= 80 ? 'var(--warn)' : 'var(--ok)' }} /></div>
        )}
        {cap != null && capPct >= 100 && <p class="banner bad small" style={{ margin: 0 }}>Cap reached: photo reading is paused for everyone until next month.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
          <div><div class="stat-label">All time</div><strong>{usd(data.totals.total_usd)}</strong></div>
          <div><div class="stat-label">Accounts</div><strong>{data.totals.accounts}</strong></div>
          <div><div class="stat-label">Users</div><strong>{data.totals.users}</strong></div>
        </div>
        <p class="meta" style={{ margin: 0 }}>
          Default free allowance: {data.settings.allowance_usd ? `${usd(data.settings.allowance_usd)} per account` : 'unlimited'}.
          Change defaults in wrangler.jsonc (AI_ALLOWANCE_USD, AI_MONTHLY_CAP_USD).
        </p>
      </section>

      <div class="seg">
        <button class={filter === 'spend' ? 'on' : ''} onClick={() => setFilter('spend')}>Using AI</button>
        <button class={filter === 'blocked' ? 'on' : ''} onClick={() => setFilter('blocked')}>Cut off</button>
        <button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All · {data.accounts.length}</button>
      </div>
      {error && <p class="banner bad">{error}</p>}
      {shown.length === 0 && <p class="muted center">No accounts here.</p>}

      <div class="cards">
        {shown.map((a) => {
          const pct = a.ai_allowance_usd ? Math.min(100, (a.ai_total_usd / a.ai_allowance_usd) * 100) : 0;
          return (
            <div class="item-card" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
              <div class="row">
                <div class="grow">
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div class="meta" style={{ overflowWrap: 'anywhere' }}>{a.owner ?? 'no owner'} · {a.members} member{a.members === 1 ? '' : 's'} · {a.warehouses} warehouse{a.warehouses === 1 ? '' : 's'}</div>
                </div>
                {a.suspended ? <span class="badge missing">off</span> : blocked(a) ? <span class="badge backordered">used up</span> : <span class="badge received">active</span>}
              </div>
              <div class="row small">
                <span class="grow">
                  <strong>{usd(a.ai_total_usd)}</strong>{a.ai_allowance_usd != null ? ` of ${usd(a.ai_allowance_usd)}` : ' (unlimited)'}
                  {a.allowance_override && <span class="meta"> · custom</span>}
                </span>
                <span class="meta">{usd(a.ai_month_usd)} this month · {a.photo_pages_month} pages · {a.ai_calls} calls</span>
              </div>
              {a.ai_allowance_usd != null && (
                <div class="progress"><div style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--bad)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)' }} /></div>
              )}
              <div class="row wrap">
                <button
                  class="btn small"
                  onClick={() => {
                    const v = prompt(`AI allowance for ${a.name} in USD (lifetime). Leave empty for the default.`, a.allowance_override ? String(a.ai_allowance_usd) : '');
                    if (v === null) return;
                    void patch(a.id, { ai_allowance_usd: v.trim() === '' ? null : Number(v) });
                  }}
                >Set allowance</button>
                <button class={`btn small${a.suspended ? '' : ' danger'}`} onClick={() => patch(a.id, { suspended: !a.suspended })}>
                  {a.suspended ? 'Turn AI back on' : 'Turn AI off'}
                </button>
                {a.last_ai_at && <span class="meta">last used {new Date(a.last_ai_at).toLocaleDateString()}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
