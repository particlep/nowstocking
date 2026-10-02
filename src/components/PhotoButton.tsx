import { useRef, useState } from 'preact/hooks';
import type { Item } from '../../shared/schema';
import { setItemPhoto } from '../data/photos';
import { CameraIcon } from './icons';

/** Take or pick a photo for an item. On iPhone the picker offers the camera or the photo library. */
export function PhotoButton({ item, class: cls = 'btn small' }: { item: Item; class?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <input
        ref={input} type="file" accept="image/*" hidden
        onChange={async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          (e.target as HTMLInputElement).value = '';
          if (!file) return;
          setBusy(true);
          setError(null);
          try { await setItemPhoto(item, file); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
        }}
      />
      <button class={cls} disabled={busy} onClick={() => input.current?.click()}>
        <CameraIcon />{busy ? 'Uploading…' : item.photo_key ? 'Replace photo' : 'Add photo'}
      </button>
      {error && <p class="banner bad small" style={{ margin: '8px 0 0' }}>{error}</p>}
    </>
  );
}
