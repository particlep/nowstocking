import { useEffect, useRef, useState } from 'preact/hooks';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/** The printed barcodes on parts and bags: the linear kinds, plus Data Matrix. Not QR, which is our location labels. */
const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix'] as const;

/**
 * Camera view that reads printed barcodes (on part and bag labels) and reports each distinct one once. The decoder
 * loads on first use and its WASM is served by the app, so it works offline.
 */
export function BarcodeScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const cb = useRef(onResult);
  cb.current = onResult;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const last = { text: '', at: 0 };

    (async () => {
      const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
      prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
      const detector = new BarcodeDetector({ formats: [...FORMATS] });
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      const v = video.current;
      if (stopped || !v) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      v.srcObject = stream;
      await v.play();
      const tick = async () => {
        if (stopped) return;
        try {
          if (v.readyState >= 2) {
            const [hit] = await detector.detect(v);
            const text = hit?.rawValue.trim();
            const now = Date.now();
            if (text && !(text === last.text && now - last.at < 2500)) {
              last.text = text;
              last.at = now;
              navigator.vibrate?.(30);
              cb.current(text);
            }
          }
        } catch { /* a frame that failed to decode; try the next */ }
        if (!stopped) timer = window.setTimeout(() => void tick(), 120);
      };
      void tick();
    })().catch((e: unknown) => { if (!stopped) setError(String(e instanceof Error ? e.message : e)); });

    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div>
      <div class="scanner barcode"><video ref={video} muted playsInline /></div>
      {error && (
        <p class="banner bad small">
          Camera unavailable: {error}. Check that camera access is allowed for this app in Settings.
        </p>
      )}
    </div>
  );
}
