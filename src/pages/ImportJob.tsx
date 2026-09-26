import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { packingResult, type ImportJob } from '../../shared/importTypes';
import { fmtQty } from '../../shared/inventory';
import type { ItemType, Op } from '../../shared/schema';
import { Page } from '../components/chrome';
import { CheckIcon, ChevronIcon, FlagIcon, PhotoIcon } from '../components/icons';
import { openPhoto } from '../components/PhotoViewer';
import { onRefresh } from '../components/PullToRefresh';
import { itemFields } from '../data/actions';
import { clearDraft, draft, loadDraft, mergeJob, needsReview, type DraftRow } from '../data/importDraft';
import { commit, insertOp } from '../data/mutate';
import { catalog } from '../data/store';
import { api } from '../data/api';
import { wpath } from '../data/workspace';

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
        const j = await api<ImportJob>(wpath(`/import/jobs/${id}`));
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
  useEffect(() => onRefresh(() => setPollKey((k) => k + 1)), []);

  const d = draft.value?.jobId === id ? draft.value : null;
  if (!job) return <Page back="Imports">{error ? <p class="banner bad">{error}</p> : <p class="muted center">Loading…</p>}</Page>;

  const reading = job.pages.filter((p) => p.status === 'reading').length;
  const failed = job.pages.filter((p) => p.status === 'failed');
  const done = job.pages.filter((p) => p.status === 'done').length;
  const rows = d?.rows ?? [];
  const flagged = rows.filter(needsReview);
  const shown = filter === 'review' ? flagged : rows;

  const retry = async (pages: number[]) => {
    setJob(await api<ImportJob>(wpath(`/import/jobs/${id}/start`), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pages }),
    }));
    setPollKey((k) => k + 1); // resume polling
  };

  const kitName = job.pages.map(packingResult).find((r) => r?.kit_name)?.kit_name;
  const firstFlagged = flagged[0];

  return (
    <Page
      back="Imports"
      title={kitName ?? 'Packing list'}
      bottom={firstFlagged && job.status !== 'committed' ? (
        <>
          <a class="btn primary lg block" href={`/import/${id}/row/${encodeURIComponent(firstFlagged.key)}`}>
            Review {flagged.length} flagged line{flagged.length === 1 ? '' : 's'}
          </a>
          {reading > 0 && <div class="meta center">Commit unlocks when all pages are read</div>}
        </>
      ) : undefined}
    >
      {job.status === 'committed' && <p class="banner ok"><CheckIcon />This import was committed to inventory.</p>}
      <section class="card stack">
        <div class="row">
          <strong class="grow">{reading > 0 ? `Reading pages · ${done} of ${job.page_count} done` : `${done} of ${job.page_count} pages read · ${rows.length} lines`}</strong>
        </div>
        <div class="page-bars" aria-hidden="true">
          {job.pages.map((p) => (
            <span
              class={p.status === 'done' ? 'done' : p.status === 'failed' ? 'failed' : p.status === 'reading' ? 'reading' : ''}
              title={`Page ${p.page}: ${p.status}`}
            />
          ))}
        </div>
        {reading > 0 && <div class="meta" style={{ fontSize: '14px' }}>You can lock your phone. Reading continues on the server.</div>}
        {job.pages.some((p) => p.image_key) && (
          <div class="chips">
            {job.pages.filter((p) => p.image_key).map((p) => (
              <button class="chip" style={{ minHeight: '36px' }} onClick={() => openPhoto(wpath(`/import/image/${p.image_key}`), `Packing list page ${p.page}`)}>
                <PhotoIcon />Page {p.page}
              </button>
            ))}
          </div>
        )}
        {failed.map((p) => <div class="small" style={{ color: 'var(--bad)' }}>Page {p.page}: {p.error}</div>)}
        {failed.length > 0 && <button class="btn small" onClick={() => retry(failed.map((p) => p.page))}>Retry failed page{failed.length === 1 ? '' : 's'}</button>}
        {error && <div class="meta">Couldn't refresh: {error}</div>}
      </section>

      {rows.length > 0 && (
        <>
          <div class="seg" role="tablist" aria-label="Filter lines">
            <button role="tab" aria-selected={filter === 'review'} class={filter === 'review' ? 'on' : ''} onClick={() => setFilter('review')}>Needs review · {flagged.length}</button>
            <button role="tab" aria-selected={filter === 'all'} class={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All lines · {rows.length}</button>
          </div>
          {filter === 'review' && flagged.length === 0 && (
            <p class="muted center small">Nothing flagged{reading ? ' yet' : ''}. Spot-check a few lines under All lines against the photos.</p>
          )}
          {shown.length > 0 && (
            <div class="list">
              {shown.map((r) => <DraftRowItem r={r} jobId={id} />)}
            </div>
          )}
        </>
      )}

      {rows.length > 0 && reading === 0 && job.status !== 'committed' && (
        <CommitPanel job={job} rows={rows} flagged={flagged.length} failedPages={failed.length} />
      )}

      <button
        class="btn danger block"
        onClick={async () => {
          if (!confirm('Delete this import and its photos? Items already committed stay in inventory.')) return;
          await api(wpath(`/import/jobs/${id}`), { method: 'DELETE' });
          await clearDraft(id);
          route('/import', true);
        }}
      >Delete import</button>
    </Page>
  );
}

function DraftRowItem({ r, jobId }: { r: DraftRow; jobId: string }) {
  const indent = r.kind === 'part' && r.indented ? 32 : 16;
  const flagged = needsReview(r);
  return (
    <a class="list-item row" href={`/import/${jobId}/row/${encodeURIComponent(r.key)}`} style={{ paddingLeft: `${indent}px`, gap: '12px' }}>
      {flagged ? <FlagIcon style={{ width: '20px', height: '20px', color: 'var(--warn)', flexShrink: 0 }} />
        : r.reviewed ? <CheckIcon style={{ width: '20px', height: '20px', color: 'var(--ok)', flexShrink: 0 }} /> : null}
      <span class="grow" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span class="code" style={{ fontSize: r.kind === 'part' ? '17px' : '15px', fontWeight: r.kind === 'part' ? 600 : 700 }}>
          {r.kind !== 'part' && <span class="badge" style={{ marginRight: '6px' }}>{r.kind === 'subkit' ? 'sub-kit' : 'bag'}</span>}
          {r.stock_code || <span class="muted">(no stock code)</span>}
        </span>
        {flagged && r.note
          ? <span class="small" style={{ color: 'var(--warn)', fontWeight: 500 }}>{r.note}</span>
          : <span class="meta">{r.description}{r.kind === 'part' ? ` · ${fmtQty(r.qty)} ${r.unit}` : ''}</span>}
      </span>
      <span class="meta">pg {r.page}</span>
      <ChevronIcon class="chev" />
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
  const suggested = job.pages.map(packingResult).find((r) => r?.kit_name)?.kit_name ?? '';
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
    await api(wpath(`/import/jobs/${job.id}/committed`), { method: 'POST' }).catch(() => {});
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
