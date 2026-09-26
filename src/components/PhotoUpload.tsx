import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { ImportKind } from '../../shared/importTypes';
import { api } from '../data/sync';
import { toJpeg } from '../lib/images';

/**
 * Pick photos, upload them to a new import job, and start background reading.
 * Resumes where it left off if an upload fails.
 */
export function PhotoUpload({ kind, noun, startLabel, onStarted, children }: {
  kind: ImportKind;
  noun: string; // "page"
  startLabel: (n: number) => string;
  onStarted: (jobId: string) => void;
  children?: ComponentChildren;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState(0);

  const upload = async () => {
    setError(null);
    try {
      let id = jobId;
      if (!id) {
        id = (await api<{ id: string }>('/api/import/jobs', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page_count: files.length, kind }),
        })).id;
        setJobId(id);
      }
      for (let i = uploaded; i < files.length; i++) {
        setProgress(`Uploading ${noun} ${i + 1} of ${files.length}…`);
        const jpeg = await toJpeg(files[i]);
        await api(`/api/import/jobs/${id}/pages/${i + 1}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpeg });
        setUploaded(i + 1);
      }
      setProgress('Starting…');
      await api(`/api/import/jobs/${id}/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      onStarted(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    }
  };

  const busy = progress != null;
  return (
    <div class="stack">
      {children}
      <input
        type="file" accept="image/*" multiple class="input" disabled={busy || !!jobId}
        onChange={(e) => {
          setFiles([...files, ...Array.from((e.target as HTMLInputElement).files ?? [])]);
          (e.target as HTMLInputElement).value = '';
        }}
      />
      {files.length > 0 && (
        <div class="list">
          {files.map((f, i) => (
            <div class="list-item row">
              <span class="grow">{noun[0].toUpperCase() + noun.slice(1)} {i + 1} <span class="meta">{f.name}</span>{i < uploaded && ' ✓'}</span>
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
        {error && jobId ? 'Retry upload' : startLabel(files.length)}
      </button>
      {progress && <p class="banner small">{progress} Keep this screen open until the upload finishes.</p>}
      {error && <p class="banner bad small">{error}</p>}
    </div>
  );
}
