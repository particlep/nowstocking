import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { LogoMark } from '../components/icons';
import { Turnstile } from '../components/Turnstile';
import { api } from '../data/api';
import { sync } from '../data/sync';
import { refreshIdentity } from '../data/workspace';

// Remember a sent code across a reload: people switch to Mail to read it, and iOS may reload the app meanwhile.
const PENDING_KEY = 'ns-signin';
const PENDING_MS = 10 * 60 * 1000; // codes last 10 minutes

function loadPending(): string | null {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as { email: string; at: number } | null;
    return p && Date.now() - p.at < PENDING_MS ? p.email : null;
  } catch {
    return null;
  }
}

function savePending(email: string | null) {
  try {
    if (email) localStorage.setItem(PENDING_KEY, JSON.stringify({ email, at: Date.now() }));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage unavailable: the screen just won't survive a reload */ }
}

/** Email one-time-code sign-in (installs with AUTH_MODE = "email"). */
export function SignInPage() {
  const { route } = useLocation();
  const pending = loadPending();
  const [step, setStep] = useState<'email' | 'code'>(pending ? 'code' : 'email');
  const [email, setEmail] = useState(pending ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bot check on "Email me a code", when this install has Turnstile turned on.
  const [sitekey, setSitekey] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    api<{ turnstileSitekey?: string | null }>('/api/auth/config').then((r) => setSitekey(r.turnstileSitekey ?? null)).catch(() => {});
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof TypeError ? 'Signing in needs a connection.' : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const send = () => run(async () => {
    try {
      await api('/api/auth/start', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), turnstile: token ?? undefined }),
      });
      savePending(email.trim());
      setStep('code');
    } finally {
      // The token was used up either way.
      if (sitekey) setResetKey((k) => k + 1);
    }
  });

  const verify = () => run(async () => {
    await api('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), code }) });
    savePending(null);
    await refreshIdentity();
    void sync();
    route('/', true);
  });

  return (
    <main class="page stack" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 48px)', maxWidth: '440px' }}>
      <div class="row" style={{ gap: '12px' }}>
        <LogoMark size={44} />
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '30px', lineHeight: 1 }}>
            Now<span style={{ color: 'var(--accent)' }}>Stocking</span>
          </div>
          <div class="meta">Parts inventory · find it, scan it, pull it</div>
        </div>
      </div>

      {step === 'email' ? (
        <form class="card stack" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <strong>Sign in</strong>
          <label class="field">
            <span>Email</span>
            <input
              class="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off"
              placeholder="you@example.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </label>
          {sitekey && <Turnstile sitekey={sitekey} action="signin" onToken={setToken} resetKey={resetKey} onError={setError} />}
          <button class="btn primary lg" type="submit" disabled={busy || !email.includes('@') || (!!sitekey && !token)}>
            {busy ? 'Sending…' : 'Email me a code'}
          </button>
          <button
            class="btn small" type="button" style={{ alignSelf: 'flex-start' }}
            disabled={!email.includes('@')}
            onClick={() => { savePending(email.trim()); setError(null); setStep('code'); }}
          >I already have a code</button>
          <p class="meta" style={{ margin: 0 }}>No password. New here? Signing in creates your workshop.</p>
        </form>
      ) : (
        <form class="card stack" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <strong>Check your email</strong>
          <p class="muted" style={{ margin: 0 }}>
            We sent a 6-digit code to {email.trim()}. It works for 10 minutes, and so do any earlier codes you asked for.
          </p>
          <label class="field">
            <span>Code</span>
            <input
              class="input code-input" style={{ letterSpacing: '6px', textAlign: 'center' }}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
              value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
            />
          </label>
          <button class="btn primary lg" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
          <div class="row">
            <button class="btn small" type="button" onClick={() => { savePending(null); setStep('email'); setCode(''); }}>Use a different email</button>
            <button class="btn small" type="button" disabled={busy} onClick={() => { setStep('email'); setCode(''); }}>Send a new code</button>
          </div>
        </form>
      )}
      {error && <p class="banner bad">{error}</p>}
      <p class="meta center" style={{ fontSize: '12px' }}>Version {__APP_VERSION__}</p>
    </main>
  );
}
