import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

import type { Template } from './labelTemplates';

const MIN_QR = 0.75;

export interface LabelSpec { code: string; description?: string | null; url: string }

function drawQr(doc: jsPDF, text: string, x: number, y: number, size: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const quiet = 2; // modules of white border inside the box; the label itself adds more
  const cell = size / (n + quiet * 2);
  doc.setFillColor(0, 0, 0);
  for (let r = 0; r < n; r++) {
    // Merge horizontal runs into one rectangle: smaller PDF, no hairline gaps between cells.
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) { c++; continue; }
      const start = c;
      while (c < n && qr.modules.get(r, c)) c++;
      doc.rect(x + (start + quiet) * cell, y + (r + quiet) * cell, (c - start) * cell, cell, 'F');
    }
  }
}

function fitFontSize(doc: jsPDF, text: string, maxWidth: number, maxPt: number): number {
  doc.setFontSize(maxPt);
  const w = doc.getTextWidth(text);
  return w <= maxWidth ? maxPt : Math.max(8, Math.floor((maxPt * maxWidth) / w));
}

export function buildLabelsPdf(t: Template, labels: LabelSpec[], startIndex: number, outlines: boolean): jsPDF {
  if (t.qr < MIN_QR) throw new Error('QR codes must be at least 0.75"');
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  const perSheet = t.cols * t.rows;
  let slot = startIndex;
  let first = true;

  const pageHeader = () => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(120);
    doc.text(`Avery ${t.id} · Print at 100% / Actual size (no "fit to page") · ${outlines ? 'TEST: outlines shown' : ''}`, 4.25, 0.3, { align: 'center' });
    doc.setTextColor(0);
  };

  for (const label of labels) {
    if (slot >= perSheet || first) {
      if (!first) doc.addPage();
      if (slot >= perSheet) slot = 0;
      pageHeader();
      if (outlines) {
        doc.setDrawColor(160);
        doc.setLineWidth(0.005);
        for (let i = 0; i < perSheet; i++) {
          const ox = t.left + (i % t.cols) * t.hPitch;
          const oy = t.top + Math.floor(i / t.cols) * t.vPitch;
          doc.roundedRect(ox, oy, t.width, t.height, t.corner, t.corner, 'S');
        }
      }
      first = false;
    }
    const x = t.left + (slot % t.cols) * t.hPitch;
    const y = t.top + Math.floor(slot / t.cols) * t.vPitch;
    const pad = (t.height - t.qr) / 2;
    drawQr(doc, label.url, x + pad, y + pad, t.qr);

    const textX = x + pad + t.qr + pad;
    const textW = x + t.width - pad - textX;
    doc.setFont('helvetica', 'bold');
    const maxPt = t.id === '5160' ? 34 : 64;
    const size = fitFontSize(doc, label.code, textW, maxPt);
    doc.setFontSize(size);
    const codeY = label.description ? y + t.height / 2 + 0.04 : y + t.height / 2 + (size / 72) * 0.35;
    doc.text(label.code, textX, codeY);
    if (label.description) {
      doc.setFont('helvetica', 'normal');
      const small = t.id === '5160' ? 8 : 12;
      doc.setFontSize(small);
      const line = doc.splitTextToSize(label.description, textW)[0] as string;
      doc.text(line, textX, codeY + (small / 72) * 1.5);
    }
    slot++;
  }
  return doc;
}
