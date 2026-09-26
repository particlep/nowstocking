import QrScanner from 'qr-scanner';
import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizeLocationCode } from '../../shared/normalize';

export interface ScannedLocation {
  code: string;
  /** Warehouse the label belongs to, when the label says. */
  warehouseId: string | null;
}

/** Accepts https://<host>/w/<warehouse>/loc/B03 (what labels encode), https://<host>/loc/B03, or a bare code. */
export function parseLocationLabel(text: string): ScannedLocation | null {
  const t = text.trim();
  try {
    const url = new URL(t);
    const m = url.pathname.match(/^(?:\/w\/([a-z0-9]{10}))?\/loc\/([^/]+)\/?$/);
    return m ? { code: normalizeLocationCode(decodeURIComponent(m[2])), warehouseId: m[1] ?? null } : null;
  } catch {
    return /^[A-Za-z0-9-]{1,24}$/.test(t) ? { code: normalizeLocationCode(t), warehouseId: null } : null;
  }
}

/** Where a scanned label should open. */
export function locationHref(loc: ScannedLocation): string {
  const code = encodeURIComponent(loc.code);
  return loc.warehouseId ? `/w/${loc.warehouseId}/loc/${code}` : `/loc/${code}`;
}

/** Camera view that reports each distinct QR payload once. */
export function Scanner({ onResult, paused }: { onResult: (text: string) => void; paused?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScanner | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const cb = useRef(onResult);
  cb.current = onResult;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!video.current) return;
    const s = new QrScanner(
      video.current,
      (r) => {
        const now = Date.now();
        if (r.data === last.current.text && now - last.current.at < 2500) return;
        last.current = { text: r.data, at: now };
        navigator.vibrate?.(30);
        cb.current(r.data);
      },
      { preferredCamera: 'environment', maxScansPerSecond: 12, highlightScanRegion: false, returnDetailedScanResult: true },
    );
    scanner.current = s;
    s.start().catch((e: unknown) => setError(String(e instanceof Error ? e.message : e)));
    return () => {
      s.destroy();
      scanner.current = null;
    };
  }, []);

  useEffect(() => {
    const s = scanner.current;
    if (!s) return;
    if (paused) s.pause();
    else s.start().catch(() => {});
  }, [paused]);

  return (
    <div>
      <div class="scanner"><video ref={video} muted playsInline /></div>
      {error && (
        <p class="banner bad small">
          Camera unavailable: {error}. Check that camera access is allowed for this app in Settings.
        </p>
      )}
    </div>
  );
}
