import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { partFromBarcode, toSearchKey } from '../../shared/normalize';
import { buildPartIndex, readPartNumber, type PartRead } from '../../shared/partReader';
import { ocrWorker } from '../lib/ocr';
import { CloseIcon, ScanIcon } from './icons';

/** The printed barcodes on parts and bags: the linear kinds, plus Data Matrix. Not QR, which is our location labels. */
const FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix'] as const;
/** Same catalog part read this many frames in a row before it's typed in. Anything else waits for a tap. */
const AGREE = 2;

type Part = { search_key: string; stock_code: string };

/** A camera button for a part-number field: reads the printed part number (or barcode) and types it in. */
export function ScanPartButton({ parts, onScan }: { parts: () => Iterable<Part>; onScan: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="icon-btn lg" aria-label="Scan a part number with the camera" onClick={() => setOpen(true)}>
        <ScanIcon />
      </button>
      {open && <PartScanner parts={parts} onClose={() => setOpen(false)} onResult={(t) => { setOpen(false); onScan(t); }} />}
    </>
  );
}

/**
 * Full-screen camera. Reads the text inside the guide box with OCR, a few times a second, and snaps it to a part in
 * the catalog; reads any barcode in view too. Types a catalog part in once two reads agree. Anything else that looks
 * like a part number is shown for the user to tap, so a bag or order number on the same label isn't typed by mistake.
 */
function PartScanner({ parts, onResult, onClose }: { parts: () => Iterable<Part>; onResult: (text: string) => void; onClose: () => void }) {
  const index = useMemo(() => buildPartIndex(parts()), []);
  const video = useRef<HTMLVideoElement>(null);
  const guide = useRef<HTMLDivElement>(null);
  const done = useRef(onResult);
  done.current = onResult;
  const [reading, setReading] = useState<PartRead | null>(null);
  const [ocrState, setOcrState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    let stopped = false;
    let stream: MediaStream | null = null;
    let finished = false;
    const finish = (text: string) => {
      if (finished || stopped) return;
      finished = true;
      navigator.vibrate?.(30);
      done.current(text);
    };

    const camera = async () => {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      const v = video.current;
      if (stopped || !v) {
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      v.srcObject = stream;
      await v.play();
      return v;
    };

    const barcodes = async (v: HTMLVideoElement) => {
      const { BarcodeDetector, prepareZXingModule } = await import('barcode-detector/ponyfill');
      prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) } });
      const detector = new BarcodeDetector({ formats: [...FORMATS] });
      while (!stopped && !finished) {
        try {
          const [hit] = v.readyState >= 2 ? await detector.detect(v) : [];
          if (hit?.rawValue.trim()) {
            // A barcode is exact: no need for reads to agree.
            const field = partFromBarcode(hit.rawValue, index.codes.keys());
            finish(index.codes.get(toSearchKey(field)) ?? field);
          }
        } catch { /* a frame that failed to decode; try the next */ }
        await new Promise((r) => setTimeout(r, 150));
      }
    };

    const text = async (v: HTMLVideoElement) => {
      let w;
      try {
        w = await ocrWorker();
      } catch {
        if (!stopped) setOcrState('failed');
        return;
      }
      if (stopped) return;
      setOcrState('ready');
      const canvas = document.createElement('canvas');
      let last = '';
      let agree = 0;
      while (!stopped && !finished) {
        const crop = cropToGuide(v, guide.current, canvas);
        if (!crop) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        let read: PartRead | null = null;
        try {
          const { data } = await w.recognize(canvas);
          read = data.text.split('\n').map((l) => readPartNumber(l, index)).find((r) => r?.known)
            ?? readPartNumber(data.text.replace(/\n/g, ' '), index);
        } catch { /* try the next frame */ }
        if (stopped) return;
        setReading(read);
        agree = read && read.text === last ? agree + 1 : read ? 1 : 0;
        last = read?.text ?? '';
        if (read?.known && agree >= AGREE) finish(read.text);
      }
    };

    camera()
      .then((v) => {
        if (!v) return;
        void barcodes(v).catch(() => { /* OCR still works without the barcode reader */ });
        void text(v);
      })
      .catch((e: unknown) => { if (!stopped) setError(String(e instanceof Error ? e.message : e)); });

    return () => {
      stopped = true;
      document.body.style.overflow = '';
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div role="dialog" aria-modal="true" aria-label="Scan a part number" class="part-scanner">
      <video ref={video} muted playsInline />
      <div class="part-scanner-top">
        <span>Line up the part number in the box</span>
        <button type="button" class="icon-btn lg" aria-label="Close the camera" onClick={onClose}><CloseIcon /></button>
      </div>
      <div ref={guide} class="part-scanner-guide" />
      <div class="part-scanner-bottom">
        {error ? (
          <p class="banner bad small" style={{ margin: 0 }}>
            Camera unavailable: {error}. Check that camera access is allowed for this app in Settings.
          </p>
        ) : reading ? (
          <button type="button" class="btn primary block" onClick={() => onResult(reading.text)}>
            Use <span class="mono">{reading.text}</span>{reading.known ? '' : ' (not in this list)'}
          </button>
        ) : (
          <p class="small" style={{ margin: 0 }}>
            {ocrState === 'loading' ? 'Starting the text reader… barcodes work now.'
              : ocrState === 'failed' ? "The text reader didn't load. Barcodes still work."
              : 'Looking for a part number…'}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Copy the part of the video frame under the guide box into the canvas, as the user sees it (the video is
 * object-fit: cover, so it's scaled and cropped on screen). Returns false until the camera has a frame.
 */
function cropToGuide(v: HTMLVideoElement, box: HTMLElement | null, canvas: HTMLCanvasElement): boolean {
  if (!box || v.readyState < 2 || !v.videoWidth) return false;
  const vr = v.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  const scale = Math.max(vr.width / v.videoWidth, vr.height / v.videoHeight);
  const ox = (vr.width - v.videoWidth * scale) / 2;
  const oy = (vr.height - v.videoHeight * scale) / 2;
  const sx = Math.max(0, (br.left - vr.left - ox) / scale);
  const sy = Math.max(0, (br.top - vr.top - oy) / scale);
  const sw = Math.min(v.videoWidth - sx, br.width / scale);
  const sh = Math.min(v.videoHeight - sy, br.height / scale);
  // Tesseract reads best with text around 30-50px tall; the box is a single line, so ~120px high is plenty.
  const k = Math.min(1, 1000 / sw, 160 / sh);
  canvas.width = Math.round(sw * k);
  canvas.height = Math.round(sh * k);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.filter = 'grayscale(1) contrast(1.4)';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return true;
}
