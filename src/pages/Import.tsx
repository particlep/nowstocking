import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { ImportPageResponse, ParsedRow } from '../../shared/importTypes';
import type { ItemType, Op, Unit } from '../../shared/schema';
import { Page } from '../components/chrome';
import { itemFields } from '../data/actions';
import { getMeta, setMeta } from '../data/idb';
import { commit, insertOp } from '../data/mutate';
import { catalog } from '../data/store';
import { api } from '../data/sync';
import { toJpegBase64 } from '../lib/images';

interface Row extends ParsedRow { key: string; page: number; unit: Unit }
interface Draft { batchId: string; pages: { page: number; image_key: string; kit_name: string | null }[]; rows: Row[] }

const DRAFT_KEY = 'importDraft';

function unitFor(description: string): Unit {
  return /\(\s*LB\s*\)\s*$/i.test(description) ? 'lb' : 'ea';
}

function toRows(res: ImportPageResponse): Row[] {
  return res.parsed.rows.map((r, i) => ({ ...r, key: `${res.page}-${i}-${crypto.randomUUID().slice(0, 6)}`, page: res.page, unit: unitFor(r.description) }));
}

export function ImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState<{ page: number; file: File; error: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void getMeta<Draft | null>(DRAFT_KEY, null).then((d) => d && setDraft(d)); }, []);
  const save = (d: Draft | null) => { setDraft(d); void setMeta(DRAFT_KEY, d); };

  const readPages = async (list: { page: number; file: File }[], base: Draft) => {
    setBusy(true);
    const errors: typeof failed = [];
    let d = base;
    for (const { page, file } of list) {
      setStatus(`Reading page ${page} of ${files.length || list.length}… this takes a minute per page.`);
      try {
        const data = await toJpegBase64(file);
        const res = await api<ImportPageResponse>('/api/import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ batch_id: d.batchId, page, media_type: 'image/jpeg', data }),
        });
        const pages = [...d.pages.filter((p) => p.page !== page), { page, image_key: res.image_key, kit_name: res.parsed.kit_name }].sort((a, b) => a.page - b.page);
        const rows = [...d.rows.filter((r) => r.page !== page), ...toRows(res)].sort((a, b) => a.page - b.page);
        d = { ...d, pages, rows };
        save(d);
      } catch (e) {
        errors.push({ page, file, error: e instanceof Error ? e.message : String(e) });
      }
    }
    setFailed(errors);
    setStatus(null);
    setBusy(false);
  };

  if (!draft || (!draft.rows.length && !busy)) {
    return (
      <Page title="Import packing list" back>
        <p class="muted">Add photos of every page of one kit's packing list, in page order. Rotated photos are fine.</p>
        <input
          type="file" accept="image/*" multiple class="input"
          onChange={(e) => setFiles([...files, ...Array.from((e.target as HTMLInputElement).files ?? [])])}
        />
        {files.length > 0 && (
          <div class="list">
            {files.map((f, i) => (
              <div class="list-item row">
                <span class="grow">Page {i + 1}: <span class="muted small">{f.name}</span></span>
                <button class="btn small" disabled={i === 0} onClick={() => { const n = [...files]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setFiles(n); }}>↑</button>
                <button class="btn small danger" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
        )}
        <button
          class="btn primary block"
          disabled={!files.length || busy}
          onClick={() => {
            const d: Draft = { batchId: crypto.randomUUID(), pages: [], rows: [] };
            save(d);
            void readPages(files.map((file, i) => ({ page: i + 1, file })), d);
          }}
        >Read {files.length || ''} page{files.length === 1 ? '' : 's'}</button>
        {status && <p class="banner">{status}</p>}
        {failed.map((f) => <p class="banner bad small">Page {f.page}: {f.error}</p>)}
      </Page>
    );
  }

  return (
    <Page title="Review import" back>
      {status && <p class="banner">{status}</p>}
      {failed.length > 0 && (
        <div class="banner bad small stack">
          {failed.map((f) => <div>Page {f.page} failed: {f.error}</div>)}
          <button class="btn small" disabled={busy} onClick={() => readPages(failed.map(({ page, file }) => ({ page, file })), draft)}>Retry failed pages</button>
        </div>
      )}
      <ReviewTable draft={draft} onChange={save} busy={busy} onDiscard={() => { save(null); setFiles([]); }} />
    </Page>
  );
}

function ReviewTable({ draft, onChange, busy, onDiscard }: { draft: Draft; onChange: (d: Draft) => void; busy: boolean; onDiscard: () => void }) {
  const { route } = useLocation();
  const cat = catalog.value;
  const kits = [...cat.kits.values()].filter((k) => k.code !== 'MISC');
  const suggested = draft.pages.find((p) => p.kit_name)?.kit_name ?? '';
  const [kitMode, setKitMode] = useState<'new' | 'existing'>('new');
  const [kitId, setKitId] = useState<number>(kits[0]?.id ?? 0);
  const [kitCode, setKitCode] = useState(() => guessKitCode(suggested));
  const [kitName, setKitName] = useState(suggested);
  const [confirmExisting, setConfirmExisting] = useState(false);
  const [showPages, setShowPages] = useState(false);

  const rows = draft.rows;
  const setRow = (key: string, patch: Partial<Row>) =>
    onChange({ ...draft, rows: rows.map((r) => (r.key === key ? { ...r, ...patch } : r)) });
  const removeRow = (key: string) => onChange({ ...draft, rows: rows.filter((r) => r.key !== key) });
  const addBelow = (key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    const base = rows[i];
    const blank: Row = { key: crypto.randomUUID(), page: base.page, kind: 'part', indented: base.kind === 'bag' || base.indented, stock_code: '', description: '', qty: 1, vans_bin: null, uncertain: false, note: null, unit: 'ea' };
    onChange({ ...draft, rows: [...rows.slice(0, i + 1), blank, ...rows.slice(i + 1)] });
  };

  const existingCount = kitMode === 'existing' ? [...cat.items.values()].filter((i) => i.kit_id === kitId).length : 0;
  const codeTaken = kitMode === 'new' && [...cat.kits.values()].some((k) => k.code === kitCode.trim().toUpperCase());
  const invalid = rows.some((r) => !r.stock_code.trim() || !(r.qty >= 0));
  const canCommit = !busy && rows.length > 0 && !invalid &&
    (kitMode === 'new' ? kitCode.trim() && kitName.trim() && !codeTaken : kitId && (existingCount === 0 || confirmExisting));
  const uncertain = rows.filter((r) => r.uncertain).length;

  const doCommit = async () => {
    const ops: Op[] = [];
    let targetKit = kitId;
    if (kitMode === 'new') {
      const k = insertOp('kits', { code: kitCode.trim().toUpperCase(), name: kitName.trim(), received_at: null });
      ops.push(k);
      targetKit = k.id;
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
    await commit(`Import ${rows.length} lines`, ops);
    onDiscard();
    route('/receive', true);
  };

  return (
    <div class="stack">
      <div class="card stack">
        <strong>{rows.length} lines from {draft.pages.length} page{draft.pages.length === 1 ? '' : 's'}</strong>
        {uncertain > 0 && <span class="small" style={{ color: 'var(--warn)' }}>{uncertain} line{uncertain === 1 ? ' is' : 's are'} highlighted as hard to read. Check them against the photo.</span>}
        <button class="btn small" onClick={() => setShowPages(!showPages)}>{showPages ? 'Hide' : 'Show'} page photos</button>
        {showPages && draft.pages.map((p) => (
          <a href={`/api/import/image/${p.image_key}`} target="_blank" rel="noreferrer">
            <img src={`/api/import/image/${p.image_key}`} alt={`Page ${p.page}`} style={{ width: '100%', borderRadius: '8px' }} loading="lazy" />
          </a>
        ))}
      </div>

      <div class="scroll-x">
        <table class="grid">
          <thead><tr><th>Pg</th><th>Type</th><th>In bag</th><th>Stock code</th><th>Description</th><th>Qty</th><th>Unit</th><th>Van's bin</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr class={r.uncertain ? 'uncertain' : ''} title={r.note ?? ''}>
                <td class="muted">{r.page}</td>
                <td>
                  <select value={r.kind} onChange={(e) => setRow(r.key, { kind: (e.target as HTMLSelectElement).value as Row['kind'] })}>
                    <option value="subkit">sub-kit</option><option value="bag">bag</option><option value="part">part</option>
                  </select>
                </td>
                <td class="center">{r.kind === 'part' && <input type="checkbox" style={{ width: 'auto' }} checked={r.indented} onChange={(e) => setRow(r.key, { indented: (e.target as HTMLInputElement).checked })} />}</td>
                <td style={{ minWidth: '130px', paddingLeft: r.kind === 'part' && r.indented ? '16px' : undefined }}>
                  <input value={r.stock_code} onInput={(e) => setRow(r.key, { stock_code: (e.target as HTMLInputElement).value })} />
                </td>
                <td style={{ minWidth: '180px' }}>
                  <input value={r.description} onInput={(e) => { const v = (e.target as HTMLInputElement).value; setRow(r.key, { description: v, unit: unitFor(v) }); }} />
                  {r.note && <div class="small" style={{ color: 'var(--warn)' }}>{r.note}</div>}
                </td>
                <td style={{ minWidth: '70px' }}><input inputMode="decimal" value={String(r.qty)} onInput={(e) => setRow(r.key, { qty: Number((e.target as HTMLInputElement).value) })} /></td>
                <td>
                  <select value={r.unit} onChange={(e) => setRow(r.key, { unit: (e.target as HTMLSelectElement).value as Unit })}>
                    <option value="ea">ea</option><option value="lb">lb</option>
                  </select>
                </td>
                <td style={{ minWidth: '70px' }}><input value={r.vans_bin ?? ''} onInput={(e) => setRow(r.key, { vans_bin: (e.target as HTMLInputElement).value || null })} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button class="btn small" onClick={() => addBelow(r.key)} aria-label="Add row below">+</button>
                  <button class="btn small danger" onClick={() => removeRow(r.key)} aria-label="Delete row">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
        {codeTaken && <p class="banner bad small">A kit with code {kitCode.trim().toUpperCase()} already exists. Pick it under Existing kit, or use a different code.</p>}
        {existingCount > 0 && (
          <label class="banner warn small row">
            <input type="checkbox" checked={confirmExisting} onChange={(e) => setConfirmExisting((e.target as HTMLInputElement).checked)} />
            <span>This kit already has {existingCount} items. Importing adds {rows.length} more and may create duplicates. Check to continue.</span>
          </label>
        )}
        {invalid && <p class="small" style={{ color: 'var(--bad)' }}>Every line needs a stock code and a quantity.</p>}
        <button class="btn primary block" disabled={!canCommit} onClick={doCommit}>Commit {rows.length} lines</button>
        <button class="btn danger block" onClick={() => confirm('Discard this import?') && onDiscard()}>Discard import</button>
      </div>
    </div>
  );
}

function guessKitCode(name: string): string {
  const m = name.toUpperCase().match(/RV-?14A?\s+([A-Z]+)/);
  return m ? m[1] : '';
}
