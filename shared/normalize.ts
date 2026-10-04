/** Uppercase, alphanumerics only. "AN470AD4-5" -> "AN470AD45", "BAG 1118" -> "BAG1118". */
export function toSearchKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Location codes are stored uppercase and trimmed: "b03" -> "B03". */
export function normalizeLocationCode(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '-');
}

/**
 * The part number in a scanned barcode, given the search keys of the parts it could be. A barcode may carry just the
 * part number, or the part number with other fields (quantity, order number) around it. Prefers a whole field that is
 * a known part, then the longest known part number inside the text, else the text as scanned.
 */
export function partFromBarcode(text: string, keys: Iterable<string>): string {
  const known = new Set(keys);
  const raw = text.trim();
  const fields = [raw, ...raw.split(/[\s,;|/\t]+/)].filter(Boolean);
  const whole = fields.find((f) => known.has(toSearchKey(f)));
  if (whole) return whole;
  const all = toSearchKey(raw);
  let best = '';
  for (const k of known) if (k.length >= 4 && k.length > best.length && all.includes(k)) best = k;
  return best || raw;
}
