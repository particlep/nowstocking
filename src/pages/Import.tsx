import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { ImportJobSummary } from '../../shared/importTypes';
import { Page } from '../components/chrome';
import { onRefresh } from '../components/PullToRefresh';
import { PhotoUpload } from '../components/PhotoUpload';
import { api } from '../data/api';
import { wpath } from '../data/workspace';

export function ImportListPage() {
  const { route } = useLocation();
  const [jobs, setJobs] = useState<ImportJobSummary[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    const load = () =>
      api<{ jobs: ImportJobSummary[] }>(wpath('/import/jobs?kind=packing_list'))
        .then((r) => { setJobs(r.jobs); setLoadErr(null); })
        .catch(() => setLoadErr('Imports need a connection.'));
    void load();
    return onRefresh(load);
  }, []);

  const open = (jobs ?? []).filter((j) => j.status !== 'committed');
  const past = (jobs ?? []).filter((j) => j.status === 'committed');

  return (
    <Page title="Import packing list" back>
      <div class="card">
        <PhotoUpload
          kind="packing_list"
          noun="page"
          startLabel={(n) => `Upload ${n || ''} page${n === 1 ? '' : 's'} and start reading`}
          onStarted={(id) => route(`/import/${id}`)}
        >
          <strong>New import</strong>
          <span class="meta" style={{ fontSize: '14px' }}>
            Add a photo of every page of one kit's packing list, in page order. Rotated photos are fine.
            Once the photos upload you can lock your phone. Pages are read in the background.
          </span>
        </PhotoUpload>
      </div>

      {loadErr && <p class="muted center small">{loadErr}</p>}
      {open.length > 0 && (
        <>
          <div class="section-title">In progress</div>
          <div class="list">{open.map((j) => <JobRow j={j} />)}</div>
        </>
      )}
      {past.length > 0 && (
        <>
          <div class="section-title">Committed</div>
          <div class="list">{past.map((j) => <JobRow j={j} />)}</div>
        </>
      )}
    </Page>
  );
}

function JobRow({ j }: { j: ImportJobSummary }) {
  const state =
    j.status === 'uploading' ? 'Upload not finished' :
    j.status === 'processing' ? `Reading… ${j.pages_done} of ${j.page_count} pages done` :
    j.status === 'committed' ? 'Committed' :
    j.pages_failed ? `${j.pages_failed} page${j.pages_failed === 1 ? '' : 's'} failed` : 'Ready to review';
  return (
    <a class="list-item" href={`/import/${j.id}`}>
      <div style={{ fontWeight: 600 }}>{j.kit_name ?? 'Packing list'} <span class="muted small">· {j.page_count} pages</span></div>
      <div class="small muted">{state} · {new Date(j.created_at).toLocaleString()}</div>
    </a>
  );
}
