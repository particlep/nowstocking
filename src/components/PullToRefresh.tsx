import { useEffect, useRef, useState } from 'preact/hooks';
import { sync } from '../data/sync';

const TRIGGER = 70; // px of (damped) pull needed to refresh
const MAX = 110;

/** Screens with their own server data listen for this and reload it. */
export const REFRESH_EVENT = 'app:refresh';

export function onRefresh(handler: () => void) {
  window.addEventListener(REFRESH_EVENT, handler);
  return () => window.removeEventListener(REFRESH_EVENT, handler);
}

/**
 * Pull down from the top of the page to sync. The installed iOS app has no
 * built-in pull-to-refresh, so this tracks the touch itself.
 */
export function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const pullRef = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1 || window.scrollY > 0) return;
      const target = e.target as HTMLElement;
      // Leave the camera view and text fields alone.
      if (target.closest('.scanner, input, textarea, select, [role="dialog"]')) return;
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };
    const onMove = (e: TouchEvent) => {
      if (!start.current) return;
      const dy = e.touches[0].clientY - start.current.y;
      const dx = Math.abs(e.touches[0].clientX - start.current.x);
      if (dy <= 0 || window.scrollY > 0 || dx > dy) {
        start.current = dy < 0 || dx > dy ? null : start.current;
        pullRef.current = 0;
        setPull(0);
        return;
      }
      const damped = Math.min(MAX, dy * 0.5);
      pullRef.current = damped;
      setPull(damped);
    };
    const onEnd = async () => {
      if (!start.current) return;
      start.current = null;
      const reached = pullRef.current >= TRIGGER;
      pullRef.current = 0;
      setPull(0);
      if (!reached || busy.current) return;
      busy.current = true;
      setRefreshing(true);
      navigator.vibrate?.(10);
      window.dispatchEvent(new Event(REFRESH_EVENT));
      await Promise.all([sync(), new Promise((r) => setTimeout(r, 600))]);
      busy.current = false;
      setRefreshing(false);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  if (!pull && !refreshing) return null;
  const shown = refreshing ? TRIGGER : pull;
  const ready = pull >= TRIGGER;
  return (
    <div class="ptr" style={{ transform: `translate(-50%, ${shown - 44}px)`, opacity: Math.min(1, shown / TRIGGER) }} aria-live="polite">
      {refreshing ? (
        <span class="ptr-spinner" aria-label="Refreshing" />
      ) : (
        <span style={{ transform: `rotate(${ready ? 180 : 0}deg)`, transition: 'transform 0.15s' }} aria-label={ready ? 'Release to refresh' : 'Pull to refresh'}>↓</span>
      )}
    </div>
  );
}
