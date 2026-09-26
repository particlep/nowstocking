/**
 * Hand a file to the user. In the installed iOS app a plain download replaces the app with a
 * viewer that has no way back, so use the share sheet (Save to Files, Print, AirDrop) where
 * available and fall back to a normal download elsewhere.
 *
 * Returns 'needs-tap' when the share sheet refused because the tap that started this has
 * expired (after a slow fetch); the caller should offer a second tap to share.
 */
export async function shareOrDownload(file: File): Promise<'shared' | 'downloaded' | 'cancelled' | 'needs-tap'> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      const name = (e as DOMException)?.name;
      if (name === 'AbortError') return 'cancelled';
      if (name === 'NotAllowedError') return 'needs-tap';
      // Anything else: fall through to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return 'downloaded';
}
