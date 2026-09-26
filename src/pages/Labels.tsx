import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Page } from '../components/chrome';
import { ShareFileButton } from '../components/ShareFileButton';
import { catalog } from '../data/store';
import { TEMPLATES, type Template } from '../lib/labelTemplates';

export function LabelsPage() {
  const { query } = useLocation();
  const cat = catalog.value;
  const locations = [...cat.locations.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const pre = query.loc ? cat.locationsByCode.get(query.loc) : undefined;
  const [selected, setSelected] = useState<Set<number>>(() => new Set(pre ? [pre.id] : []));
  const [tid, setTid] = useState<Template['id']>(pre && pre.type !== 'bin' ? '5163' : '5160');
  const [start, setStart] = useState(0);
  const [outlines, setOutlines] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const t = TEMPLATES.find((x) => x.id === tid)!;
  const perSheet = t.cols * t.rows;

  const toggle = (id: number) => {
    const n = new Set(selected);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSelected(n);
  };

  const makePdf = async () => {
    // jsPDF is large; load it only when a PDF is made.
    const { buildLabelsPdf } = await import('../lib/labels');
    const chosen = locations.filter((l) => selected.has(l.id));
    const doc = buildLabelsPdf(
      t,
      chosen.map((l) => ({
        code: l.code,
        description: showDesc ? l.description : null,
        url: `${window.location.origin}/loc/${encodeURIComponent(l.code)}`,
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
          <div class="row wrap">
            <button class="btn small" onClick={() => setSelected(new Set(locations.map((l) => l.id)))}>All</button>
            <button class="btn small" onClick={() => setSelected(new Set(locations.filter((l) => l.type === 'bin').map((l) => l.id)))}>Bins</button>
            <button class="btn small" onClick={() => setSelected(new Set(locations.filter((l) => l.type !== 'bin').map((l) => l.id)))}>Shelves & other</button>
            <button class="btn small" onClick={() => setSelected(new Set())}>None</button>
          </div>
          <div class="list">
            {locations.map((l) => (
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
      <ShareFileButton label="Make PDF" make={makePdf} disabled={!selected.size} class="btn primary lg block" />
      <p class="small muted">Opens the share sheet: choose Print, or Save to Files. Print at 100% / Actual size. Hold a test print against a label sheet up to the light before using real labels.</p>
    </Page>
  );
}
