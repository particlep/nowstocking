import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import { instructionsResult, type ImportJob, type InstructionPart } from '../../shared/importTypes';
import { effectiveLocation } from '../../shared/inventory';
import { toSearchKey } from '../../shared/normalize';
import type { Op } from '../../shared/schema';
import { LocTags, StatusBadge } from '../components/ItemRow';
import { Page } from '../components/chrome';
import { CheckIcon, FlagIcon, PhotoIcon } from '../components/icons';
import { openPhoto } from '../components/PhotoViewer';
import { onRefresh } from '../components/PullToRefresh';
import { commit, insertOp } from '../data/mutate';
import { catalog, tables } from '../data/store';
import { api } from '../data/api';
import { wpath } from '../data/workspace';
import { matchPart } from '../lib/matchParts';

const POLL_MS = 4000;

interface Row {
  key: string; // search key of the code as read
  read: string; // part number as the page printed it
  code: string; // part number to put on the pick list (may be a suggestion the user picked)
  qty: string;
  include: boolean;
  kind: InstructionPart['kind'];
  context: string[];
  uncertain: boolean;
  note: string | null;
}

/** Merge parts from all read pages: one row per part number, contexts joined, stated quantities added. */
function rowsFrom(job: ImportJob): Row[] {
  const byKey = new Map<string, Row & { qtys: number[] }>();
  for (const p of job.pages) {
    const r = instructionsResult(p);
    if (!r) continue;
    for (const part of r.parts) {
      const key = toSearchKey(part.stock_code);
      if (!key) continue;
      const ctx = job.pages.length > 1 ? `p${p.page}: ${part.context}` : part.context;
      const existing = byKey.get(key);
      if (existing) {
        existing.context.push(ctx);
        if (part.qty != null) existing.qtys.push(part.qty);
        existing.uncertain ||= part.uncertain;
        existing.note ??= part.note;
        continue;
      }
      byKey.set(key, {
        key, read: part.stock_code, code: part.stock_code, qty: '', include: false, kind: part.kind,
        context: [ctx], uncertain: part.uncertain, note: part.note, qtys: part.qty != null ? [part.qty] : [],
      });
    }
  }
  return [...byKey.values()].map(({ qtys, ...r }) => ({ ...r, qty: qtys.length ? String(qtys.reduce((a, b) => a + b, 0)) : '' }));
}

export function InstructionReviewPage() {
  const { params } = useRoute();
  const { route } = useLocation();
  const id = params.id!;
  const cat = catalog.value;
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<{ section: string; page: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const j = await api<ImportJob>(wpath(`/import/jobs/${id}`));
        if (stop) return;
        setJob(j);
        setError(null);
        if (j.pages.some((p) => p.status === 'reading')) timer = setTimeout(poll, POLL_MS);
      } catch (e) {
        if (stop) return;
        setError(e instanceof Error ? e.message : String(e));
        timer = setTimeout(poll, POLL_MS * 3);
      }
    };
    void poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [id, pollKey]);
  useEffect(() => onRefresh(() => setPollKey((k) => k + 1)), []);

  // Seed rows and header fields as pages finish; keep the user's edits for rows already shown.
  useEffect(() => {
    if (!job) return;
    const fresh = rowsFrom(job);
    setRows((prev) => {
      const old = new Map(prev.map((r) => [r.key, r]));
      return fresh.map((r) => {
        const kept = old.get(r.key);
        if (kept) return { ...kept, context: r.context };
        const m = matchPart(catalog.value, r.code);
        return { ...r, include: m.exact.length > 0 };
      });
    });
    const results = job.pages.map(instructionsResult).filter((r) => r != null);
    if (!meta && results.length && !job.pages.some((p) => p.status === 'reading')) {
      const labels = [...new Set(results.map((r) => r.page_label).filter(Boolean))] as string[];
      setMeta({
        section: results.find((r) => r.section)?.section ?? labels[0]?.split('-')[0] ?? '',
        page: labels.length > 1 ? `${labels[0]}–${labels[labels.length - 1]}` : labels[0] ?? '',
        title: job.title ?? results.find((r) => r.title)?.title ?? '',
      });
    }
  }, [job]);

  const matches = useMemo(() => new Map(rows.map((r) => [r.key, matchPart(cat, r.code)])), [rows, cat]);

  if (!job) {
    return <Page back="Pick lists">{error ? <p class="banner bad">{error}</p> : <p class="muted center">Loading…</p>}</Page>;
  }

  const reading = job.pages.filter((p) => p.status === 'reading').length;
  const failed = job.pages.filter((p) => p.status === 'failed');
  const done = job.pages.filter((p) => p.status === 'done').length;
  const chosen = rows.filter((r) => r.include);
  const existing = meta?.page
    ? [...tables.value.pick_lists.values()].find((l) => !l.deleted_at && l.page?.trim().toUpperCase() === meta.page.trim().toUpperCase())
    : undefined;
  const set = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const create = async (intoExisting: boolean) => {
    if (!meta) return;
    setBusy(true);
    const ops: Op[] = [];
    let listId = existing?.id;
    if (!intoExisting || !existing) {
      const pl = insertOp('pick_lists', { section: meta.section.trim() || meta.page.split('-')[0] || '?', page: meta.page.trim() || null, title: meta.title.trim() });
      ops.push(pl);
      listId = pl.id;
    }
    const already = new Set(
      [...tables.value.pick_list_lines.values()].filter((l) => l.pick_list_id === listId && !l.deleted_at).map((l) => l.search_key),
    );
    for (const r of chosen) {
      const key = toSearchKey(r.code);
      if (already.has(key)) continue;
      already.add(key);
      const n = Number(r.qty);
      ops.push(insertOp('pick_list_lines', {
        pick_list_id: listId!, stock_code: r.code.trim(), search_key: key, qty_needed: r.qty && n > 0 ? n : null, pulled: 0,
      }));
    }
    await commit(`Pick list ${meta.page || meta.section} from photos`, ops);
    await api(wpath(`/import/jobs/${id}/committed`), { method: 'POST' }).catch(() => {});
    route(`/pick/${listId}`, true);
  };

  const retry = async () => {
    await api(wpath(`/import/jobs/${id}/start`), {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pages: failed.map((p) => p.page) }),
    });
    setPollKey((k) => k + 1);
  };

  return (
    <Page
      back="Pick lists"
      title="New pick list"
      bottom={!reading && rows.length > 0 && job.status !== 'committed' ? (
        <>
          <button class="btn primary lg block" disabled={busy || !chosen.length || !meta?.title.trim() || (!meta?.section.trim() && !meta?.page.trim())} onClick={() => create(false)}>
            Create pick list · {chosen.length} part{chosen.length === 1 ? '' : 's'}
          </button>
          {existing && (
            <button class="btn block" disabled={busy || !chosen.length} onClick={() => create(true)}>Add to existing {existing.page}</button>
          )}
        </>
      ) : undefined}
    >
      {job.status === 'committed' && <p class="banner ok"><CheckIcon />A pick list was already made from these photos.</p>}

      <section class="card stack">
        <strong>{reading ? `Reading ${job.page_count === 1 ? 'the page' : 'pages'} · ${done} of ${job.page_count} done` : `${rows.length} part numbers found`}</strong>
        <div class="page-bars" aria-hidden="true">
          {job.pages.map((p) => <span class={p.status === 'done' ? 'done' : p.status === 'failed' ? 'failed' : p.status === 'reading' ? 'reading' : ''} />)}
        </div>
        {reading > 0 && <div class="meta" style={{ fontSize: '14px' }}>Takes about a minute. You can lock your phone.</div>}
        <div class="chips">
          {job.pages.filter((p) => p.image_key).map((p) => (
            <button class="chip" style={{ minHeight: '36px' }} onClick={() => openPhoto(wpath(`/import/image/${p.image_key}`), `Instructions photo ${p.page}`)}>
              <PhotoIcon />Photo {p.page}
            </button>
          ))}
        </div>
        {failed.map((p) => <div class="small" style={{ color: 'var(--bad)' }}>Photo {p.page}: {p.error}</div>)}
        {failed.length > 0 && <button class="btn small" onClick={retry}>Retry</button>}
      </section>
      {job.status !== 'committed' && !reading && (
        <button
          class="btn small danger"
          style={{ alignSelf: 'flex-start' }}
          onClick={async () => {
            if (!confirm('Discard these photos without making a pick list?')) return;
            await api(wpath(`/import/jobs/${id}`), { method: 'DELETE' });
            route('/pick', true);
          }}
        >Discard photos</button>
      )}

      {meta && (
        <section class="card stack">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}>
            <label class="field"><span>Page</span><input class="input" value={meta.page} placeholder="10-27" onInput={(e) => setMeta({ ...meta, page: (e.target as HTMLInputElement).value })} /></label>
            <label class="field"><span>Section</span><input class="input" value={meta.section} placeholder="10" onInput={(e) => setMeta({ ...meta, section: (e.target as HTMLInputElement).value })} /></label>
          </div>
          <label class="field"><span>Title</span><input class="input" value={meta.title} placeholder="Aft deck" onInput={(e) => setMeta({ ...meta, title: (e.target as HTMLInputElement).value })} /></label>
          {!meta.title.trim() && <p class="small" style={{ margin: 0, color: 'var(--bad)' }}>A title is required.</p>}
          {existing && <p class="meta" style={{ margin: 0 }}>You already have a pick list for {existing.page}. You can add these parts to it instead.</p>}
        </section>
      )}

      {rows.length > 0 && (
        <>
          <div class="row">
            <div class="section-title grow" style={{ margin: '12px 4px 0' }}>Parts on {rows.length === 1 ? 'this page' : 'these pages'}</div>
            <button class="btn small" onClick={() => setRows(rows.map((r) => ({ ...r, include: (matches.get(r.key)?.exact.length ?? 0) > 0 })))}>In stock only</button>
            <button class="btn small" onClick={() => setRows(rows.map((r) => ({ ...r, include: true })))}>All</button>
          </div>
          <div class="cards">
            {rows.map((r) => <PartRow r={r} match={matches.get(r.key)!} onChange={(patch) => set(r.key, patch)} />)}
          </div>
        </>
      )}
    </Page>
  );
}

function PartRow({ r, match, onChange }: { r: Row; match: ReturnType<typeof matchPart>; onChange: (p: Partial<Row>) => void }) {
  const cat = catalog.value;
  const found = match.exact.length > 0;
  return (
    <div class={`item-card${r.uncertain ? ' warn' : ''}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px', opacity: r.include ? 1 : 0.75 }}>
      <div class="row" style={{ gap: '12px' }}>
        <input type="checkbox" class="check" checked={r.include} aria-label={`Include ${r.code}`} onChange={(e) => onChange({ include: (e.target as HTMLInputElement).checked })} />
        <div class="grow">
          <div class="code">{r.code}{r.code !== r.read && <span class="meta" style={{ fontFamily: 'var(--font-sans)', fontWeight: 400 }}> (read as {r.read})</span>}</div>
          <div class="meta">{r.kind !== 'part' ? `${r.kind} · ` : ''}{r.context.join('; ')}</div>
        </div>
        <input
          class="input" style={{ width: '64px', minHeight: '40px', padding: '6px 8px', textAlign: 'center' }}
          inputMode="decimal" placeholder="Qty" aria-label={`Quantity of ${r.code}`}
          value={r.qty} onInput={(e) => onChange({ qty: (e.target as HTMLInputElement).value })}
        />
      </div>
      {r.uncertain && (
        <div class="row small" style={{ color: 'var(--warn)', paddingLeft: '38px' }}><FlagIcon style={{ width: '16px', height: '16px' }} />{r.note ?? 'Hard to read. Check it against the photo.'}</div>
      )}
      {found ? (
        match.exact.map((it) => (
          <div class="row" style={{ paddingLeft: '38px' }}>
            <span class="meta grow">{cat.kits.get(it.kit_id)?.code}{it.description ? ` · ${it.description}` : ''} <StatusBadge status={it.status} /></span>
            <LocTags placements={effectiveLocation(cat, it).placements} size="sm" />
          </div>
        ))
      ) : (
        <div style={{ paddingLeft: '38px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span class="tag-none" style={{ alignSelf: 'flex-start' }}>Not in inventory</span>
          {match.suggestions.length > 0 && (
            <div class="chips">
              <span class="meta" style={{ alignSelf: 'center' }}>Did you mean</span>
              {match.suggestions.map((s) => (
                <button class="chip mono" style={{ minHeight: '36px' }} onClick={() => onChange({ code: s.stock_code, include: true })}>{s.stock_code}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {r.code !== r.read && (
        <button class="btn small" style={{ alignSelf: 'flex-end' }} onClick={() => onChange({ code: r.read })}>Use {r.read} as printed</button>
      )}
    </div>
  );
}
