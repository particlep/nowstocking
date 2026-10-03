// CHANGELOG.md, parsed for the app's What's new screen. Headings are "## <version> · <YYYY-MM-DD>"; a version is a
// number, or a range like "1–25" for early releases. Each "- " bullet is one change.

export interface Release {
  version: string;
  /** The highest version number the entry covers, for comparing with the running version. */
  number: number;
  date: string;
  changes: string[];
}

export function parseChangelog(md: string): Release[] {
  const out: Release[] = [];
  for (const line of md.split(/\r?\n/)) {
    const head = /^## (\d+(?:[–-]\d+)?) · (\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (head) {
      const parts = head[1].split(/[–-]/).map(Number);
      out.push({ version: head[1], number: Math.max(...parts), date: head[2], changes: [] });
    } else if (out.length && line.startsWith('- ')) {
      out[out.length - 1].changes.push(line.slice(2).trim());
    }
  }
  return out.sort((a, b) => b.number - a.number);
}

/** Releases newer than the version someone last saw, up to the one they're running. */
export function newSince(releases: Release[], seen: number, running: number): Release[] {
  return releases.filter((r) => r.number > seen && r.number <= running);
}
