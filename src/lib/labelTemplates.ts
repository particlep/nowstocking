export interface Template {
  id: '5160' | '5163';
  name: string;
  cols: number;
  rows: number;
  width: number; // inches
  height: number;
  top: number;
  left: number;
  hPitch: number;
  vPitch: number;
  qr: number;
  corner: number;
}

export const TEMPLATES: Template[] = [
  { id: '5160', name: 'Avery 5160 · bins · 2.625" × 1", 30 per sheet', cols: 3, rows: 10, width: 2.625, height: 1, top: 0.5, left: 0.1875, hPitch: 2.75, vPitch: 1, qr: 0.85, corner: 0.0625 },
  { id: '5163', name: 'Avery 5163 · shelves · 4" × 2", 10 per sheet', cols: 2, rows: 5, width: 4, height: 2, top: 0.5, left: 0.15625, hPitch: 4.1875, vPitch: 2, qr: 1.6, corner: 0.0625 },
];
