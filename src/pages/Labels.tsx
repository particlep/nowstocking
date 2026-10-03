import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Page } from '../components/chrome';
import { ShareFileButton } from '../components/ShareFileButton';
import { CheckIcon } from '../components/icons';
import { getGlobal, setGlobal } from '../data/idb';
import { catalog, me } from '../data/store';
import { api } from '../data/api';
import { warehouseId } from '../data/workspace';
import { TEMPLATES, type Template } from '../lib/labelTemplates';

export function LabelsPage() {
  const { query } = useLocation();
  const cat = catalog.value;
  const locations = [...cat.locations.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const pre = query.loc ? cat.locationsByCode.get(query.loc) : undefined;
  const [selected, setSelected] = useState<Set<number>>(() => new Set(pre ? [pre.id] : []));
  const [tid, setTid] = useState<Template['id']>(pre && pre.type !== 'bin' ? '5163' : '5160');
  const [start, setStart] = useState(0);
  const [q, setQ] = useState('');
  const [outlines, setOutlines] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const [emailOn, setEmailOn] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [sending, setSending] = useState(false);
  const [emailResult, setEmailResult] = useState<{ ok: boolean; text: string } | null>(null);
  const t = TEMPLATES.find((x) => x.id === tid)!;

  // Remember the email choice; default the address to the signed-in user.
  useEffect(() => {
    void getGlobal<{ on: boolean; to: string } | null>('labelEmail', null).then((saved) => {
      if (saved) { setEmailOn(saved.on); setEmailTo(saved.to); }
    });
  }, []);
  useEffect(() => {
    if (!emailTo && me.value.includes('@')) setEmailTo(me.value);
  }, [me.value]);
  const perSheet = t.cols * t.rows;

  // Narrow the list by code, description or type. Selections outside the search are kept.
  // The whole search as typed, so "Shelf 2" finds "Shelf 2, 1A" but not "Shelf 1, 2A".
  const needle = q.trim().toLowerCase();
  const bare = needle.replace(/[^a-z0-9]/g, '');
  const words = needle ? [needle] : [];
  const shown = needle
    ? locations.filter((l) =>
      l.code.toLowerCase().includes(needle) || (!!bare && l.code.toLowerCase().replace(/[^a-z0-9]/g, '').includes(bare))
      || l.type.includes(needle) || (l.description ?? '').toLowerCase().includes(needle))
    : locations;
  const hiddenSelected = words.length ? [...selected].filter((id) => !shown.some((l) => l.id === id)).length : 0;
  const addShown = (on: boolean) => {
    const n = new Set(selected);
    for (const l of shown) { if (on) n.add(l.id); else n.delete(l.id); }
    setSelected(n);
  };

  const toggle = (id: number) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  const summary = () => {
    const codes = locations.filter((l) => selected.has(l.id)).map((l) => l.code);
    const list = codes.length <= 6 ? codes.join(', ') : `${codes[0]}–${codes[codes.length - 1]} (${codes.length})`;
    return `${list} on Avery ${t.id}${outlines ? ', test print' : ''}`;
  };

  const emailPdf = async () => {
    setEmailResult(null);
    setSending(true);
    try {
      const file = await makePdf();
      const form = new FormData();
      form.append('to', emailTo.trim());
      form.append('summary', summary());
      form.append('file', file);
      const r = await api<{ to: string }>('/api/email/labels', { method: 'POST', body: form });
      setEmailResult({ ok: true, text: `Sent to ${r.to}` });
      void setGlobal('labelEmail', { on: true, to: emailTo.trim() });
    } catch (e) {
      const msg = e instanceof TypeError ? 'Emailing needs a connection.' : e instanceof Error ? e.message : String(e);
      setEmailResult({ ok: false, text: msg });
    } finally {
      setSending(false);
    }
  };

  const makePdf = async () => {
    // jsPDF is large; load it only when a PDF is made.
    const { buildLabelsPdf } = await import('../lib/labels').catch(() => {
      // An update removed this version's files. Reload into the new version.
      window.location.reload();
      throw new Error('Updating the app. Try again in a moment.');
    });
    const chosen = locations.filter((l) => selected.has(l.id));
    const doc = buildLabelsPdf(
      t,
      chosen.map((l) => ({
        code: l.code,
        description: showDesc ? l.description : null,
        url: `${window.location.origin}/w/${warehouseId.value}/loc/${encodeURIComponent(l.code)}`,
      })),
      start,
      outlines,
    );
    const name = `labels-${t.id}${outlines ? '-test' : ''}.pdf`;
    return new File([doc.output('blob')], name, { type: 'application/pdf' });
  };

  return (
    <Page title="Labels" back>
      <label class="field">
        <span>Template</span>
        <select class="input" value={tid} onChange={(e) => { setTid((e.target as HTMLSelectElement).value as Template['id']); setStart(0); }}>
          {TEMPLATES.map((x) => <option value={x.id}>{x.name}</option>)}
        </select>
      </label>

      <div class="section-title">Locations ({selected.size} selected)</div>
      {locations.length === 0 ? (
        <p class="muted">No locations yet. <a href="/locations">Add some</a> first.</p>
      ) : (
        <>
          <input
            class="input" type="search" placeholder="Search, e.g. S2, RB-1 or Shelf 2" aria-label="Search locations"
            autoCorrect="off" spellcheck={false} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
          {words.length ? (
            <div class="row wrap">
              <button class="btn small" disabled={!shown.length} onClick={() => addShown(true)}>Select {shown.length} shown</button>
              <button class="btn small" disabled={!shown.some((l) => selected.has(l.id))} onClick={() => addShown(false)}>Unselect shown</button>
              <button class="btn small" onClick={() => setQ('')}>Clear search</button>
            </div>
          ) : (
            <div class="row wrap">
              <button class="btn small" onClick={() => setSelected(new Set(locations.map((l) => l.id)))}>All</button>
              <button class="btn small" onClick={() => setSelected(new Set(locations.filter((l) => l.type === 'bin').map((l) => l.id)))}>Bins</button>
              <button class="btn small" onClick={() => setSelected(new Set(locations.filter((l) => l.type !== 'bin').map((l) => l.id)))}>Shelves & other</button>
              <button class="btn small" onClick={() => setSelected(new Set())}>None</button>
            </div>
          )}
          {hiddenSelected > 0 && <p class="meta" style={{ margin: '0 4px' }}>Plus {hiddenSelected} selected that this search hides. They're still printed.</p>}
          {words.length > 0 && !shown.length && <p class="muted center small">No locations match "{q.trim()}".</p>}
          <div class="list" hidden={!shown.length}>
            {shown.map((l) => (
              <label class="list-item row">
                <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />
                <span class="tag sm">{l.code}</span>
                <span class="muted small grow">{l.type}{l.description ? ` · ${l.description}` : ''}</span>
              </label>
            ))}
          </div>
        </>
      )}

      <div class="section-title">Start at label (tap the first unused one)</div>
      <div class="label-grid" style={{ gridTemplateColumns: `repeat(${t.cols}, 1fr)` }}>
        {Array.from({ length: perSheet }, (_, i) => (
          <button
            class={i < start ? 'used' : i === start ? 'start' : ''}
            style={{ aspectRatio: `${t.width} / ${t.height}` }}
            onClick={() => setStart(i)}
          >{i + 1}</button>
        ))}
      </div>

      <label class="row small"><input type="checkbox" checked={showDesc} onChange={(e) => setShowDesc((e.target as HTMLInputElement).checked)} /> Print location description under the code</label>
      <label class="row small"><input type="checkbox" checked={outlines} onChange={(e) => setOutlines((e.target as HTMLInputElement).checked)} /> Test on plain paper (adds label outlines)</label>
      <label class="row small">
        <input
          type="checkbox" checked={emailOn}
          onChange={(e) => {
            const on = (e.target as HTMLInputElement).checked;
            setEmailOn(on);
            setEmailResult(null);
            void setGlobal('labelEmail', { on, to: emailTo.trim() });
          }}
        /> Email the PDF
      </label>
      {emailOn && (
        <label class="field">
          <span>Send to</span>
          <input
            class="input" type="email" inputMode="email" autoCapitalize="off" autoCorrect="off" placeholder="you@example.com"
            value={emailTo} onInput={(e) => setEmailTo((e.target as HTMLInputElement).value)}
          />
        </label>
      )}

      {emailOn ? (
        <button class="btn primary lg block" disabled={!selected.size || sending || !/^\S+@\S+\.\S+$/.test(emailTo.trim())} onClick={emailPdf}>
          {sending ? 'Sending…' : 'Email PDF'}
        </button>
      ) : (
        <ShareFileButton label="Make PDF" make={makePdf} disabled={!selected.size} class="btn primary lg block" />
      )}
      {emailResult && (
        <p class={`banner ${emailResult.ok ? 'ok' : 'bad'}`}>{emailResult.ok && <CheckIcon />}{emailResult.text}</p>
      )}
      <p class="small muted">
        {emailOn ? 'Emails the PDF as an attachment, to print from a computer.' : 'Opens the share sheet: choose Print, or Save to Files.'}{' '}
        Print at 100% / Actual size. Hold a test print against a label sheet up to the light before using real labels.
      </p>
    </Page>
  );
}
