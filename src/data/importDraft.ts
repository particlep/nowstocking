// Local review state for one import job: the parsed rows plus the user's edits, kept in IndexedDB
// so review survives app restarts. Pages that finish later are merged in as they arrive.
import { signal } from '@preact/signals';
import { packingResult, type ImportJob, type ParsedRow } from '../../shared/importTypes';
import type { Unit } from '../../shared/schema';
import { getMeta, setMeta } from './idb';

export interface DraftRow extends ParsedRow {
  key: string;
  page: number;
  unit: Unit;
  reviewed: boolean;
}

export interface Draft {
  jobId: string;
  pages: number[]; // pages whose rows are in `rows`
  rows: DraftRow[];
}

export const draft = signal<Draft | null>(null);

const metaKey = (jobId: string) => `importDraft:${jobId}`;

export function unitFor(description: string): Unit {
  return /\(\s*LB\s*\)\s*$/i.test(description) ? 'lb' : 'ea';
}

export async function loadDraft(jobId: string): Promise<Draft> {
  if (draft.value?.jobId === jobId) return draft.value;
  const d = (await getMeta<Draft | null>(metaKey(jobId), null)) ?? { jobId, pages: [], rows: [] };
  draft.value = d;
  return d;
}

export async function saveDraft(d: Draft) {
  draft.value = d;
  await setMeta(metaKey(d.jobId), d);
}

export async function clearDraft(jobId: string) {
  if (draft.value?.jobId === jobId) draft.value = null;
  await setMeta(metaKey(jobId), null);
}

/** Add rows from pages that finished since the draft was last saved, keeping page order. */
export async function mergeJob(job: ImportJob) {
  const d = await loadDraft(job.id);
  const fresh = job.pages.filter((p) => p.status === 'done' && packingResult(p) && !d.pages.includes(p.page));
  if (!fresh.length) return d;
  let rows = d.rows;
  for (const p of fresh) {
    const added: DraftRow[] = packingResult(p)!.rows.map((r, i) => ({
      ...r, key: `${p.page}-${i}`, page: p.page, unit: unitFor(r.description), reviewed: false,
    }));
    // Insert after the last row of any earlier page.
    let at = rows.length;
    for (let i = 0; i < rows.length; i++) if (rows[i].page > p.page) { at = i; break; }
    rows = [...rows.slice(0, at), ...added, ...rows.slice(at)];
  }
  const next = { ...d, pages: [...d.pages, ...fresh.map((p) => p.page)], rows };
  if (draft.value?.jobId === job.id) await saveDraft(next);
  else await setMeta(metaKey(job.id), next);
  return next;
}

export async function updateRow(key: string, patch: Partial<DraftRow>) {
  const d = draft.value;
  if (!d) return;
  await saveDraft({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
}

export async function removeRow(key: string) {
  const d = draft.value;
  if (!d) return;
  await saveDraft({ ...d, rows: d.rows.filter((r) => r.key !== key) });
}

export async function insertRowAfter(key: string): Promise<string | null> {
  const d = draft.value;
  if (!d) return null;
  const i = d.rows.findIndex((r) => r.key === key);
  if (i < 0) return null;
  const base = d.rows[i];
  const row: DraftRow = {
    key: `new-${crypto.randomUUID().slice(0, 8)}`, page: base.page, kind: 'part',
    indented: base.kind === 'bag' || base.indented, stock_code: '', description: '', qty: 1, vans_bin: null,
    uncertain: true, note: 'Added by hand', unit: 'ea', reviewed: false,
  };
  await saveDraft({ ...d, rows: [...d.rows.slice(0, i + 1), row, ...d.rows.slice(i + 1)] });
  return row.key;
}

/** Rows that still need a look: flagged by the reader and not yet marked reviewed. */
export function needsReview(r: DraftRow) {
  return r.uncertain && !r.reviewed;
}
