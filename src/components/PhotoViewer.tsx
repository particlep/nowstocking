import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { CloseIcon } from './icons';

/**
 * Full-screen photo viewer with pinch, pan and double-tap zoom. Photos open here instead of
 * as a raw URL, which in the installed iOS app replaces the app with no way back.
 */
export const viewerPhoto = signal<{ src: string; alt: string; line?: PhotoLine } | null>(null);

/** The import line being checked, shown over the photo so you know what to look for. */
export interface PhotoLine {
  code: string;
  detail?: string;
  note?: string;
}

export function openPhoto(src: string, alt: string, line?: PhotoLine) {
  viewerPhoto.value = { src, alt, line };
}

const MAX = 6;

export function PhotoViewer() {
  const photo = viewerPhoto.value;
  const [t, setT] = useState({ scale: 1, x: 0, y: 0 });
  const tRef = useRef(t);
  tRef.current = t;
  const gesture = useRef<{ dist: number; scale: number; cx: number; cy: number; x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  useEffect(() => {
    setT({ scale: 1, x: 0, y: 0 });
    if (!photo) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (viewerPhoto.value = null);
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [photo?.src]);

  if (!photo) return null;

  const point = (e: TouchEvent) => {
    const [a, b] = [e.touches[0], e.touches[1] ?? e.touches[0]];
    return { cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2, dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) };
  };

  const onStart = (e: TouchEvent) => {
    const p = point(e);
    gesture.current = { ...p, scale: tRef.current.scale, x: tRef.current.x, y: tRef.current.y };
    if (e.touches.length === 1) {
      const now = Date.now();
      if (now - lastTap.current < 280) {
        // Double tap: zoom in around the finger, or back out.
        const zoomed = tRef.current.scale > 1.1;
        const s = zoomed ? 1 : 2.5;
        const cx = p.cx - window.innerWidth / 2;
        const cy = p.cy - window.innerHeight / 2;
        setT(zoomed ? { scale: 1, x: 0, y: 0 } : { scale: s, x: -cx * (s - 1), y: -cy * (s - 1) });
        lastTap.current = 0;
        gesture.current = null;
        return;
      }
      lastTap.current = now;
    }
  };

  const onMove = (e: TouchEvent) => {
    const g = gesture.current;
    if (!g) return;
    e.preventDefault();
    const p = point(e);
    if (e.touches.length >= 2 && g.dist > 0) {
      const scale = Math.min(MAX, Math.max(1, g.scale * (p.dist / g.dist)));
      setT({ scale, x: g.x + (p.cx - g.cx), y: g.y + (p.cy - g.cy) });
    } else if (tRef.current.scale > 1) {
      setT({ scale: tRef.current.scale, x: g.x + (p.cx - g.cx), y: g.y + (p.cy - g.cy) });
    }
  };

  const onEnd = (e: TouchEvent) => {
    if (e.touches.length) {
      const p = point(e);
      gesture.current = { ...p, scale: tRef.current.scale, x: tRef.current.x, y: tRef.current.y };
    } else {
      gesture.current = null;
      if (tRef.current.scale <= 1.02) setT({ scale: 1, x: 0, y: 0 });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.alt}
      style={{ position: 'fixed', inset: 0, zIndex: 50, background: '#0b111b', touchAction: 'none', overflow: 'hidden' }}
      onTouchStart={onStart}
      onTouchMove={onMove}
      onTouchEnd={onEnd}
      onTouchCancel={onEnd}
    >
      <img
        src={photo.src}
        alt={photo.alt}
        draggable={false}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain',
          transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
          transition: gesture.current ? 'none' : 'transform 0.18s ease-out',
          userSelect: 'none', WebkitUserSelect: 'none',
        }}
      />
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, display: 'flex', alignItems: 'center', gap: '12px',
        padding: 'calc(env(safe-area-inset-top) + 10px) 16px 10px', background: 'linear-gradient(rgb(11 17 27 / 0.85), transparent)',
      }}>
        <span style={{ flex: 1, color: '#fff', fontSize: '15px', fontWeight: 500 }}>{photo.alt}</span>
        <button
          class="btn"
          style={{ background: '#fff', border: 0, color: 'var(--navy)', minHeight: '44px' }}
          onClick={() => (viewerPhoto.value = null)}
        ><CloseIcon />Close</button>
      </div>
      {photo.line && (
        <div style={{
          position: 'absolute', left: '12px', right: '12px', top: 'calc(env(safe-area-inset-top) + 68px)',
          maxWidth: '560px', margin: '0 auto', padding: '10px 14px', borderRadius: '14px',
          background: 'rgb(255 255 255 / 0.94)', color: 'var(--navy)', boxShadow: '0 6px 20px rgb(0 0 0 / 0.35)', pointerEvents: 'none',
        }}>
          <div class="mono" style={{ fontWeight: 600, fontSize: '17px' }}>{photo.line.code || 'No stock code'}</div>
          {photo.line.detail && <div style={{ fontSize: '14px', color: 'var(--muted)' }}>{photo.line.detail}</div>}
          {photo.line.note && (
            <div style={{ marginTop: '6px', fontSize: '14px', fontWeight: 500, color: 'var(--warn-fg)' }}>⚑ {photo.line.note}</div>
          )}
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(env(safe-area-inset-bottom) + 16px)', textAlign: 'center', color: 'rgb(255 255 255 / 0.7)', fontSize: '13px' }}>
        Pinch or double-tap to zoom
      </div>
    </div>
  );
}
