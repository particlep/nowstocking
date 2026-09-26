import { useEffect, useRef } from 'preact/hooks';

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  reset(id: string): void;
  remove(id: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let loading: Promise<TurnstileApi> | null = null;

/** Load Cloudflare's widget script once, in explicit-render mode. */
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')));
    s.onerror = () => { loading = null; reject(new Error('Turnstile failed to load')); };
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Cloudflare Turnstile widget. Tokens are single-use, so bump `resetKey` after every request that used one;
 * the widget then issues a fresh token.
 */
export function Turnstile({ sitekey, action, onToken, resetKey, onError }: {
  sitekey: string;
  action: string;
  onToken: (token: string | null) => void;
  resetKey: number;
  onError?: (message: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    let cancelled = false;
    loadTurnstile()
      .then((t) => {
        if (cancelled || !el.current) return;
        widget.current = t.render(el.current, {
          sitekey,
          action,
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => cb.current(token),
          'expired-callback': () => cb.current(null),
          'error-callback': () => { cb.current(null); onError?.('The bot check had a problem. It will retry.'); },
        });
      })
      .catch(() => onError?.("The bot check couldn't load. Check your connection."));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [sitekey, action]);

  useEffect(() => {
    if (resetKey && widget.current && window.turnstile) {
      cb.current(null);
      window.turnstile.reset(widget.current);
    }
  }, [resetKey]);

  return <div ref={el} style={{ minHeight: '65px' }} />;
}
