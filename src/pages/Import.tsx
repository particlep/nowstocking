import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import type { ImportJobSummary } from '../../shared/importTypes';
import { Page } from '../components/chrome';
import { api } from '../data/sync';
import { toJpeg } from '../lib/images';

export function ImportListPage() {
  const { route } = useLocation();
  const [jobs, setJobs] = useState<ImportJobSummary[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);

  useEffect(() => {
    api<{ jobs: ImportJobSummary[] }>('/api/import/jobs')
      .then((r) => setJobs(r.jobs))
      .catch(() => setLoadErr('Imports need a connection.'));
  }, []);

  const upload = async () => {
    setError(null);
    try {
      let id = jobId;
      if (!id) {
        id = (await api<{ id: string }>('/api/import/jobs', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page_count: files.length }),
        })).id;
        setJobId(id);
      }
      // Resume after a failed upload: skip pages already sent.
      for (let i = uploaded; i < files.length; i++) {
        setProgress(`Uploading page ${i + 1} of ${files.length}…`);
        const jpeg = await toJpeg(files[i]);
        await api(`/api/import/jobs/${id}/pages/${i + 1}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpeg });
        setUploaded(i + 1);
      }
      setProgress('Starting…');
      await api(`/api/import/jobs/${id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      route(`/import/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  const busy = progress != null;
  const open = (jobs ?? []).filter((j) => j.status !== 'committed');
  const past = (jobs ?? []).filter((j) => j.status === 'committed');

  return (
    <Page title="Import packing list" back>
      <div class="card stack">
        <strong>New import</strong>
        <span class="small muted">
          Add a photo of every page of one kit's packing list, in page order. Rotated photos are fine.
          Once the photos upload you can lock your phone. Pages are read in the background.
        </span>
        <input
          type="file" accept="image/*" multiple class="input" disabled={busy || !!jobId}
          onChange={(e) => setFiles([...files, ...Array.from((e.target as HTMLInputElement).files ?? [])])}
        />
        {files.length > 0 && (
          <div class="list">
            {files.map((f, i) => (
              <div class="list-item row">
                <span class="grow">Page {i + 1} <span class="muted small">{f.name}</span>{i < uploaded && ' ✓'}</span>
                {!jobId && (
                  <>
                    <button class="btn small" disabled={i === 0} onClick={() => { const n = [...files]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; setFiles(n); }} aria-label="Move up">↑</button>
                    <button class="btn small danger" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <button class="btn primary block" disabled={!files.length || busy} onClick={upload}>
          {error && jobId ? 'Retry upload' : `Upload ${files.length || ''} page${files.length === 1 ? '' : 's'} and start reading`}
        </button>
        {progress && <p class="banner small">{progress} Keep this screen open until the upload finishes.</p>}
        {error && <p class="banner bad small">{error}</p>}
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
