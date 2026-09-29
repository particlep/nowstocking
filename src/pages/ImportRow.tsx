import { useEffect, useState } from 'preact/hooks';
import { useLocation, useRoute } from 'preact-iso';
import type { ImportJob } from '../../shared/importTypes';
import type { Unit } from '../../shared/schema';
import { Page } from '../components/chrome';
import { openPhoto } from '../components/PhotoViewer';
import { CheckIcon, FlagIcon, PhotoIcon, PlusIcon } from '../components/icons';
import {
  draft, insertRowAfter, loadDraft, needsReview, removeRow, unitFor, updateRow, type DraftRow,
} from '../data/importDraft';
import { api } from '../data/api';
import { wpath } from '../data/workspace';

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
    api<ImportJob>(wpath(`/import/jobs/${jobId}`))
      .then((j) => setImageKeys(Object.fromEntries(j.pages.filter((p) => p.image_key).map((p) => [p.page, p.image_key!]))))
      .catch(() => {});
  }, [jobId]);

  const d = draft.value?.jobId === jobId ? draft.value : null;
  if (!d) return <Page back="All lines"><p class="muted center">Loading…</p></Page>;
  const idx = d.rows.findIndex((r) => r.key === key);
  const r = d.rows[idx];
  if (!r) return <Page back="All lines"><p class="muted center">This line was removed.</p></Page>;

  const go = (k: string | undefined) => (k ? route(`/import/${jobId}/row/${encodeURIComponent(k)}`, true) : route(`/import/${jobId}`, true));
  const nextFlagged = [...d.rows.slice(idx + 1), ...d.rows.slice(0, idx)].find(needsReview);
  const container = findContainer(d.rows, idx);
  const set = (patch: Partial<DraftRow>) => void updateRow(r.key, patch);
  const flaggedLeft = d.rows.filter(needsReview).length;

  // Rough crop: aim the photo at this line's position on its page.
  const pageRows = d.rows.filter((x) => x.page === r.page);
  const posInPage = pageRows.findIndex((x) => x.key === r.key);
  const focusY = pageRows.length > 1 ? 12 + (posInPage / (pageRows.length - 1)) * 76 : 50;
  const lastLine = flaggedLeft <= (needsReview(r) ? 1 : 0);

  // On a flagged line, the arrows step through the flagged lines only. Otherwise they step through every line.
  const flaggedMode = needsReview(r);
  const flagged = d.rows.filter(needsReview);
  const flaggedPos = flagged.findIndex((x) => x.key === r.key);
  const prev = flaggedMode ? flagged[flaggedPos - 1] : d.rows[idx - 1];
  const next = flaggedMode ? flagged[flaggedPos + 1] : d.rows[idx + 1];

  return (
    <Page
      back="All lines"
      actions={
        <span class="meta" style={{ fontSize: '14px' }}>
          {flaggedMode ? `Flagged ${flaggedPos + 1} of ${flagged.length}` : `Line ${idx + 1} of ${d.rows.length}`}
        </span>
      }
      bottom={
        <>
          <button
            class="btn primary lg block"
            onClick={async () => {
              await updateRow(r.key, { reviewed: true });
              go(nextFlagged?.key !== r.key ? nextFlagged?.key : undefined);
            }}
          ><CheckIcon />{lastLine ? 'Done · back to list' : 'Done · next flagged'}</button>
          <div class="row">
            <button class="btn grow" disabled={!prev} onClick={() => go(prev?.key)}>{flaggedMode ? '‹ Previous flagged' : '‹ Previous line'}</button>
            <button class="btn grow" disabled={!next} onClick={() => go(next?.key)}>{flaggedMode ? 'Next flagged ›' : 'Next line ›'}</button>
          </div>
        </>
      }
    >
      {r.uncertain && (
        <div class={`banner ${r.reviewed ? 'ok' : 'warn'}`}>
          {r.reviewed ? <CheckIcon /> : <FlagIcon />}
          <span style={{ fontWeight: 500 }}>{r.reviewed ? 'Reviewed' : r.note ?? 'Flagged as hard to read'}{r.reviewed && r.note ? ` · ${r.note}` : ''}</span>
        </div>
      )}
      {flaggedMode && <p class="meta" style={{ margin: '6px 4px 0' }}>Check it against the photo. Fix anything that's wrong, then tap Done. Changes save as you type.</p>}

      {imageKeys[r.page] ? (
        <button
          type="button"
          onClick={() => openPhoto(wpath(`/import/image/${imageKeys[r.page]}`), `Packing list page ${r.page}`, {
            code: r.stock_code,
            detail: [r.description, `${r.qty} ${r.unit === 'lb' ? 'lb' : 'each'}`, r.vans_bin && `bin ${r.vans_bin}`].filter(Boolean).join(' · '),
            note: needsReview(r) ? (r.note ?? 'Flagged as hard to read') : undefined,
          })}
          aria-label={`Open page ${r.page} photo full size`}
          style={{ display: 'block', position: 'relative', width: '100%', padding: 0, border: 0, background: 'none' }}
        >
          <img
            class="photo"
            src={wpath(`/import/image/${imageKeys[r.page]}`)}
            alt={`Packing list page ${r.page}, around this line`}
            style={{ height: '170px', objectFit: 'cover', objectPosition: `center ${focusY}%` }}
          />
          <span class="badge" style={{ position: 'absolute', right: '10px', bottom: '10px', background: 'rgb(27 42 65 / 0.8)', color: '#fff' }}>Page {r.page} · tap to zoom</span>
        </button>
      ) : (
        <div class="photo row" style={{ height: '120px', justifyContent: 'center', color: 'var(--muted)' }}><PhotoIcon style={{ width: '28px', height: '28px' }} /></div>
      )}

      <div class="seg" role="group" aria-label="Line type">
        {KINDS.map((k) => (
          <button class={r.kind === k.value ? 'on' : ''} aria-pressed={r.kind === k.value} onClick={() => set({ kind: k.value })}>{k.label}</button>
        ))}
      </div>
      {r.kind === 'part' && (
        <label class="row" style={{ fontSize: '15px' }}>
          <input type="checkbox" style={{ width: '24px', height: '24px', accentColor: 'var(--navy)' }} checked={r.indented} onChange={(e) => set({ indented: (e.target as HTMLInputElement).checked })} />
          <span>{container?.kind === 'bag' || r.indented ? <>Inside <span class="mono" style={{ fontWeight: 600 }}>{container?.stock_code ?? 'the bag above'}</span></> : 'Inside the bag above it'}</span>
        </label>
      )}
      {r.kind !== 'part' && container && <div class="meta">Under {container.stock_code}</div>}

      <label class="field">
        <span>Stock code</span>
        <input
          class="input code-input" value={r.stock_code}
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
        <label class="field">
          <span>Qty</span>
          <input class="input" inputMode="decimal" value={String(r.qty)} onInput={(e) => set({ qty: Number((e.target as HTMLInputElement).value) })} />
        </label>
        <label class="field">
          <span>Unit</span>
          <select class="input" value={r.unit} onChange={(e) => set({ unit: (e.target as HTMLSelectElement).value as Unit })}>
            <option value="ea">each</option>
            <option value="lb">lb</option>
          </select>
        </label>
        <label class="field">
          <span>Van's bin</span>
          <input class="input" value={r.vans_bin ?? ''} onInput={(e) => set({ vans_bin: (e.target as HTMLInputElement).value || null })} />
        </label>
      </div>

      <div class="row">
        <button class="btn grow" onClick={async () => { const k = await insertRowAfter(r.key); if (k) go(k); }}><PlusIcon />Add line after</button>
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
