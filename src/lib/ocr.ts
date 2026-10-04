import type { Worker } from 'tesseract.js';

let worker: Promise<Worker> | null = null;

/**
 * The OCR worker, started on first use and kept for the session. It reads one line of part-number characters. The
 * engine and English data are served from /ocr (scripts/copy-ocr.mjs), so OCR works offline once it has loaded.
 */
export function ocrWorker(): Promise<Worker> {
  worker ??= (async () => {
    const { createWorker, OEM, PSM } = await import('tesseract.js');
    const w = await createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: '/ocr/worker.min.js',
      corePath: '/ocr',
      langPath: '/ocr',
      workerBlobURL: false,
    });
    await w.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_LINE,
      // The space keeps words apart: without it "F-01406B  QTY 4" reads as one word.
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
      preserve_interword_spaces: '1',
    });
    return w;
  })().catch((e: unknown) => {
    worker = null; // let the next scan try again
    throw e;
  });
  return worker;
}
