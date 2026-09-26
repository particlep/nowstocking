import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import type { ImportJob } from '../../shared/importTypes';
import { fmtQty } from '../../shared/inventory';
import type { ItemType, Op } from '../../shared/schema';
import { Page } from '../components/chrome';
import { itemFields } from '../data/actions';
import { clearDraft, draft, loadDraft, mergeJob, needsReview, type DraftRow } from '../data/importDraft';
import { commit, insertOp } from '../data/mutate';
import { catalog } from '../data/store';
import { api } from '../data/sync';

const POLL_MS = 4000;

export function ImportJobPage() {
  const { params } = useRoute();
  const { route } = useLocation();
  const id = params.id!;
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'review' | 'all'>('review');
  const [pollKey, setPollKey] = useState(0);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    void loadDraft(id);
    const poll = async () => {
      try {
        const j = await api<ImportJob>(`/api/import/jobs/${id}`);
        if (stop) return;
        setJob(j);
        setError(null);
        await mergeJob(j);
        if (j.pages.some((p) => p.status === 'reading')) timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (stop) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(poll, POLL_MS * 3);
      }
    };
    void poll();
    const onVisible = () => document.visibilityState === 'visible' && void poll();
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [id, pollKey]);

  const d = draft.value?.jobId === id ? draft.value : null;
  if (!job) return <Page title="Import" back>{error ? <p class="banner bad">{error}</p> : <p class="muted center">Loading…</p>}</Page>;

  const reading = job.pages.filter((p) => p.status === 'reading').length;
  const failed = job.pages.filter((p) => p.status === 'failed');
  const done = job.pages.filter((p) => p.status === 'done').length;
  const rows = d?.rows ?? [];
  const flagged = rows.filter(needsReview);
  const shown = filter === 'review' ? flagged : rows;

  const retry = async (pages: number[]) => {
    setJob(await api<ImportJob>(`/api/import/jobs/${id}/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pages }),
    }));
    setPollKey((k) => k + 1); // resume polling
  };

  return (
    <Page title="Review import" back>
      {job.status === 'committed' && <p class="banner small">This import was committed to inventory.</p>}
      <div class="card stack">
        {reading > 0 ? (
          <>
            <strong>Reading pages… {done} of {job.page_count} done</strong>
            <span class="small muted">This runs on the server. You can lock your phone or leave this screen and come back.</span>
          </>
        ) : (
          <strong>{done} of {job.page_count} pages read · {rows.length} lines</strong>
        )}
        <div class="row wrap">
          {job.pages.map((p) => (
            <a
              class={`badge ${p.status === 'failed' ? 'missing' : p.status === 'done' ? 'received' : ''}`}
              style={{ fontSize: '14px', padding: '6px 10px', textDecoration: 'none' }}
              href={p.image_key ? `/api/import/image/${p.image_key}` : undefined}
              target="_blank" rel="noreferrer"
            >
              Pg {p.page}: {p.status === 'reading' ? 'reading…' : p.status}
            </a>
          ))}
        </div>
        {failed.map((p) => <div class="small" style={{ color: 'var(--bad)' }}>Page {p.page}: {p.error}</div>)}
        {failed.length > 0 && <button class="btn small" onClick={() => retry(failed.map((p) => p.page))}>Retry failed page{failed.length === 1 ? '' : 's'}</button>}
        {error && <div class="small muted">Couldn't refresh: {error}</div>}
      </div>

      {rows.length > 0 && (
        <>
          <div class="seg">
            <button class={filter === 'review' ? 'on' : ''} onClick={() => setFilter('review')}>Needs review ({flagged.length})</button>
            <button class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All lines ({rows.length})</button>
          </div>
          {filter === 'review' && flagged.length === 0 && (
            <p class="muted center small">Nothing flagged{reading ? ' yet' : ''}. Spot-check a few lines under All lines against the photos.</p>
          )}
          <div class="list">
            {shown.map((r) => <DraftRowItem r={r} jobId={id} />)}
          </div>
        </>
      )}

      {rows.length > 0 && reading === 0 && job.status !== 'committed' && (
        <CommitPanel job={job} rows={rows} flagged={flagged.length} failedPages={failed.length} />
      )}

      <button
        class="btn danger block"
        onClick={async () => {
          if (!confirm('Delete this import and its photos? Items already committed stay in inventory.')) return;
          await api(`/api/import/jobs/${id}`, { method: 'DELETE' });
          await clearDraft(id);
          route('/import', true);
        }}
      >Delete import</button>
    </Page>
  );
}

function DraftRowItem({ r, jobId }: { r: DraftRow; jobId: string }) {
  const indent = r.kind === 'part' && r.indented ? 28 : r.kind === 'part' || r.kind === 'bag' ? 14 : 14;
  return (
    <a class="list-item" href={`/import/${jobId}/row/${encodeURIComponent(r.key)}`} style={{ paddingLeft: `${indent}px` }}>
      <div class="row">
        <div class="grow">
          <div style={{ fontWeight: r.kind === 'part' ? 600 : 800, fontSize: r.kind === 'subkit' ? '18px' : '17px' }}>
            {needsReview(r) && <span style={{ color: 'var(--warn)' }}>⚠ </span>}
            {r.reviewed && <span style={{ color: 'var(--ok)' }}>✓ </span>}
            {r.stock_code || <span class="muted">(no stock code)</span>}
          </div>
          <div class="small muted">{r.description}</div>
          {needsReview(r) && r.note && <div class="small" style={{ color: 'var(--warn)' }}>{r.note}</div>}
        </div>
        <div class="small muted" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          {r.kind === 'part' ? `${fmtQty(r.qty)} ${r.unit}` : r.kind === 'subkit' ? 'sub-kit' : 'bag'}
          <div>pg {r.page}</div>
        </div>
      </div>
    </a>
  );
}

function guessKitCode(name: string): string {
  const m = name.toUpperCase().match(/RV-?14A?\s+([A-Z]+)/);
  return m ? m[1] : '';
}

function CommitPanel({ job, rows, flagged, failedPages }: { job: ImportJob; rows: DraftRow[]; flagged: number; failedPages: number }) {
  const { route } = useLocation();
  const cat = catalog.value;
  const kits = [...cat.kits.values()].filter((k) => k.code !== 'MISC');
  const suggested = job.pages.find((p) => p.result?.kit_name)?.result?.kit_name ?? '';
  const [kitMode, setKitMode] = useState<'new' | 'existing'>('new');
  const [kitId, setKitId] = useState<number>(kits[0]?.id ?? 0);
  const [kitCode, setKitCode] = useState(() => guessKitCode(suggested));
  const [kitName, setKitName] = useState(suggested);
  const [confirmExisting, setConfirmExisting] = useState(false);
  const [confirmFlagged, setConfirmFlagged] = useState(false);
  const [busy, setBusy] = useState(false);

  const existingCount = kitMode === 'existing' ? [...cat.items.values()].filter((i) => i.kit_id === kitId).length : 0;
  const code = kitCode.trim().toUpperCase();
  const codeTaken = kitMode === 'new' && [...cat.kits.values()].some((k) => k.code === code);
  const invalid = rows.filter((r) => !r.stock_code.trim() || !(r.qty >= 0)).length;
  const canCommit = !busy && !invalid && (flagged === 0 || confirmFlagged) &&
    (kitMode === 'new' ? !!code && !!kitName.trim() && !codeTaken : !!kitId && (existingCount === 0 || confirmExisting));

  const doCommit = async () => {
    setBusy(true);
    const ops: Op[] = [];
    let targetKit = kitId;
    let targetCode = kits.find((k) => k.id === kitId)?.code ?? '';
    if (kitMode === 'new') {
      const k = insertOp('kits', { code, name: kitName.trim(), received_at: null });
      ops.push(k);
      targetKit = k.id;
      targetCode = code;
    }
    let sort = 0;
    for (const i of cat.items.values()) if (i.kit_id === targetKit) sort = Math.max(sort, i.sort_order);
    let subkit: number | null = null;
    let bag: number | null = null;
    for (const r of rows) {
      const parent: number | null = r.kind === 'subkit' ? null : r.kind === 'bag' ? subkit : r.indented && bag ? bag : subkit;
      const op: Op = insertOp<'items'>('items', {
        kit_id: targetKit, parent_id: parent, item_type: r.kind as ItemType, ...itemFields(r.stock_code),
        description: r.description.trim() || null, qty: r.qty, unit: r.unit, vans_bin: r.vans_bin?.trim() || null,
        status: 'expected', source: 'import', notes: null, sort_order: ++sort,
      });
      ops.push(op);
      if (r.kind === 'subkit') { subkit = op.id; bag = null; }
      if (r.kind === 'bag') bag = op.id;
      if (r.kind === 'part' && !r.indented) bag = null;
    }
    await commit(`Import ${rows.length} lines into ${targetCode}`, ops);
    await api(`/api/import/jobs/${job.id}/committed`, { method: 'POST' }).catch(() => {});
    await clearDraft(job.id);
    route(`/receive/${encodeURIComponent(targetCode)}`, true);
  };

  return (
    <div class="card stack">
      <strong>Commit to kit</strong>
      <div class="seg">
        <button class={kitMode === 'new' ? 'on' : ''} onClick={() => setKitMode('new')}>New kit</button>
        <button class={kitMode === 'existing' ? 'on' : ''} disabled={!kits.length} onClick={() => setKitMode('existing')}>Existing kit</button>
      </div>
      {kitMode === 'new' ? (
        <div class="row">
          <label class="field" style={{ width: '110px' }}><span>Code</span><input class="input" value={kitCode} autoCapitalize="characters" onInput={(e) => setKitCode((e.target as HTMLInputElement).value)} /></label>
          <label class="field grow"><span>Name</span><input class="input" value={kitName} onInput={(e) => setKitName((e.target as HTMLInputElement).value)} /></label>
        </div>
      ) : (
        <select class="input" value={kitId} onChange={(e) => { setKitId(Number((e.target as HTMLSelectElement).value)); setConfirmExisting(false); }}>
          {kits.map((k) => <option value={k.id}>{k.code} · {k.name}</option>)}
        </select>
      )}
      {codeTaken && <p class="banner bad small">Kit {code} already exists. Choose it under Existing kit, or use another code.</p>}
      {existingCount > 0 && (
        <label class="banner warn small row">
          <input type="checkbox" checked={confirmExisting} onChange={(e) => setConfirmExisting((e.target as HTMLInputElement).checked)} />
          <span>This kit already has {existingCount} items. Importing adds {rows.length} more and may create duplicates.</span>
        </label>
      )}
      {failedPages > 0 && <p class="banner bad small">{failedPages} page{failedPages === 1 ? '' : 's'} failed to read. Retry above, or those lines will be missing.</p>}
      {flagged > 0 && (
        <label class="banner warn small row">
          <input type="checkbox" checked={confirmFlagged} onChange={(e) => setConfirmFlagged((e.target as HTMLInputElement).checked)} />
          <span>{flagged} flagged line{flagged === 1 ? ' hasn’t' : 's haven’t'} been reviewed. Commit anyway.</span>
        </label>
      )}
      {invalid > 0 && <p class="small" style={{ color: 'var(--bad)' }}>{invalid} line{invalid === 1 ? '' : 's'} missing a stock code or quantity.</p>}
      <button class="btn primary block" disabled={!canCommit} onClick={doCommit}>Commit {rows.length} lines</button>
    </div>
  );
}
