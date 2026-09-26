/** Uppercase, alphanumerics only. "AN470AD4-5" -> "AN470AD45", "BAG 1118" -> "BAG1118". */
export function toSearchKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Location codes are stored uppercase and trimmed: "b03" -> "B03". */
export function normalizeLocationCode(s: string): string {
  return s.trim().toUpperCase().replace(/\s+/g, '-');
}
