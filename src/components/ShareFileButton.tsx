import { useState } from 'preact/hooks';
import { shareOrDownload } from '../lib/share';

/** Builds a file on tap and shares it. If iOS needs a fresh tap after the build, asks for one. */
export function ShareFileButton({ label, make, disabled, class: cls = 'btn primary block' }: {
  label: string;
  make: () => Promise<File>;
  disabled?: boolean;
  class?: string;
}) {
  const [ready, setReady] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const file = ready ?? (await make());
      const result = await shareOrDownload(file);
      setReady(result === 'needs-tap' ? file : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button class={cls} disabled={disabled || busy} onClick={run}>
        {busy ? 'Preparing…' : ready ? `Share ${ready.name}` : label}
      </button>
      {ready && <p class="meta center" style={{ margin: 0 }}>Ready. Tap again to open the share sheet.</p>}
      {error && <p class="banner bad small">{error}</p>}
    </>
  );
}
