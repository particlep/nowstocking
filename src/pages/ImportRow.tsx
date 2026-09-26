import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import type { ImportJob } from '../../shared/importTypes';
import type { Unit } from '../../shared/schema';
import { Page } from '../components/chrome';
import {
  draft, insertRowAfter, loadDraft, needsReview, removeRow, unitFor, updateRow, type DraftRow,
} from '../data/importDraft';
import { api } from '../data/sync';

const KINDS: { value: DraftRow['kind']; label: string }[] = [
  { value: 'subkit', label: 'Sub-kit' },
  { value: 'bag', label: 'Bag' },
  { value: 'part', label: 'Part' },
];

export function ImportRowPage() {
  const { params } = useRoute();
  const { route } = useLocation();
  const jobId = params.id!;
  const key = decodeURIComponent(params.key ?? '');
  const [imageKeys, setImageKeys] = useState<Record<number, string>>({});

  useEffect(() => {
    void loadDraft(jobId);
    api<ImportJob>(`/api/import/jobs/${jobId}`)
      .then((j) => setImageKeys(Object.fromEntries(j.pages.filter((p) => p.image_key).map((p) => [p.page, p.image_key!]))))
      .catch(() => {});
  }, [jobId]);

  const d = draft.value?.jobId === jobId ? draft.value : null;
  if (!d) return <Page title="Review line" back><p class="muted center">Loading…</p></Page>;
  const idx = d.rows.findIndex((r) => r.key === key);
  const r = d.rows[idx];
  if (!r) return <Page title="Review line" back><p class="muted center">This line was removed.</p></Page>;

  const go = (k: string | undefined) => (k ? route(`/import/${jobId}/row/${encodeURIComponent(k)}`, true) : route(`/import/${jobId}`, true));
  const nextFlagged = [...d.rows.slice(idx + 1), ...d.rows.slice(0, idx)].find(needsReview);
  const container = findContainer(d.rows, idx);
  const set = (patch: Partial<DraftRow>) => void updateRow(r.key, patch);
  const flaggedLeft = d.rows.filter(needsReview).length;

  return (
    <Page title={`Line ${idx + 1} of ${d.rows.length}`} back>
      {r.uncertain && (
        <div class={`banner ${r.reviewed ? '' : 'warn'} small`}>
          {r.reviewed ? '✓ Reviewed. ' : '⚠ Flagged as hard to read. '}
          {r.note}
        </div>
      )}

      <div class="small muted">
        Page {r.page}{container && <> · inside <strong>{container.stock_code}</strong></>}
      </div>

      <div class="seg">
        {KINDS.map((k) => (
          <button class={r.kind === k.value ? 'on' : ''} onClick={() => set({ kind: k.value })}>{k.label}</button>
        ))}
      </div>
      {r.kind === 'part' && (
        <label class="row">
          <input type="checkbox" style={{ width: '22px', height: '22px' }} checked={r.indented} onChange={(e) => set({ indented: (e.target as HTMLInputElement).checked })} />
          <span>In the bag above it</span>
        </label>
      )}

      <label class="field">
        <span>Stock code</span>
        <input
          class="input" style={{ fontSize: '24px', fontWeight: 700 }} value={r.stock_code}
          autoCapitalize="characters" autoCorrect="off" spellcheck={false}
          onInput={(e) => set({ stock_code: (e.target as HTMLInputElement).value })}
        />
      </label>
      <label class="field">
        <span>Description</span>
        <input
          class="input" value={r.description}
          onInput={(e) => { const v = (e.target as HTMLInputElement).value; set({ description: v, unit: unitFor(v) }); }}
        />
      </label>
      <div class="row">
        <label class="field grow">
          <span>Qty</span>
          <input class="input" inputMode="decimal" value={String(r.qty)} onInput={(e) => set({ qty: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="field grow">
          <span>Unit</span>
          <select class="input" value={r.unit} onChange={(e) => set({ unit: (e.target as HTMLSelectElement).value as Unit })}>
            <option value="ea">each</option>
            <option value="lb">lb (by weight)</option>
          </select>
        </label>
        <label class="field grow">
          <span>Van's bin</span>
          <input class="input" value={r.vans_bin ?? ''} onInput={(e) => set({ vans_bin: (e.target as HTMLInputElement).value || null })} />
        </label>
      </div>

      <button
        class="btn primary block"
        onClick={async () => {
          await updateRow(r.key, { reviewed: true });
          go(nextFlagged?.key !== r.key ? nextFlagged?.key : undefined);
        }}
      >
        {flaggedLeft > (needsReview(r) ? 1 : 0) ? 'Looks right · next flagged' : 'Looks right · back to list'}
      </button>
      <div class="row">
        <button class="btn grow" disabled={idx === 0} onClick={() => go(d.rows[idx - 1]?.key)}>‹ Previous line</button>
        <button class="btn grow" disabled={idx === d.rows.length - 1} onClick={() => go(d.rows[idx + 1]?.key)}>Next line ›</button>
      </div>

      {imageKeys[r.page] && (
        <>
          <div class="section-title">Page {r.page} photo · tap to open full size and zoom</div>
          <a href={`/api/import/image/${imageKeys[r.page]}`} target="_blank" rel="noreferrer">
            <img src={`/api/import/image/${imageKeys[r.page]}`} alt={`Packing list page ${r.page}`} style={{ width: '100%', borderRadius: '12px' }} />
          </a>
        </>
      )}

      <div class="row">
        <button class="btn grow" onClick={async () => { const k = await insertRowAfter(r.key); if (k) go(k); }}>+ Add line after</button>
        <button
          class="btn danger grow"
          onClick={async () => {
            if (!confirm(`Remove ${r.stock_code || 'this line'} from the import?`)) return;
            const next = d.rows[idx + 1]?.key ?? d.rows[idx - 1]?.key;
            await removeRow(r.key);
            go(next);
          }}
        >Remove line</button>
      </div>
      <a class="btn block" href={`/import/${jobId}`}>Back to all lines</a>
    </Page>
  );
}

/** The bag (for an indented part) or sub-kit this line will be filed under. */
function findContainer(rows: DraftRow[], idx: number): DraftRow | null {
  const r = rows[idx];
  if (r.kind === 'subkit') return null;
  for (let i = idx - 1; i >= 0; i--) {
    const x = rows[i];
    if (r.kind === 'part' && r.indented && x.kind === 'bag') return x;
    if (x.kind === 'subkit') return x;
    if (r.kind === 'part' && r.indented && x.kind === 'part' && !x.indented) return null;
  }
  return null;
}
