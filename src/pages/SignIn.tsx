import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { LogoMark } from '../components/icons';
import { Turnstile } from '../components/Turnstile';
import { api } from '../data/api';
import { sync } from '../data/sync';
import { legal, refreshIdentity } from '../data/workspace';

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
  return <AuthPage mode="signin" />;
}

/** New users: a name, an email and the terms, then the same emailed code. */
export function SignUpPage() {
  return <AuthPage mode="signup" />;
}

function TermsLinks() {
  const { terms, privacy } = legal.value;
  return (
    <>
      the {terms ? <a href={terms} target="_blank" rel="noreferrer">Terms of Service</a> : 'Terms of Service'} and{' '}
      {privacy ? <a href={privacy} target="_blank" rel="noreferrer">Privacy Policy</a> : 'Privacy Policy'}
    </>
  );
}

/** The AI notice and the agreement checkbox, shared by sign-up and the "updated terms" screen. */
export function TermsAgreement({ agreed, onChange }: { agreed: boolean; onChange: (v: boolean) => void }) {
  return (
    <>
      <p class="banner small" style={{ margin: 0 }}>
        Photos you ask NowStocking to read, like packing lists and plans pages, are sent to third-party AI services
        (currently Anthropic's Claude) to be transcribed. We don't control those services; they handle the photos
        under their own terms.
      </p>
      <label class="row small" style={{ alignItems: 'flex-start', gap: '10px' }}>
        <input
          type="checkbox" checked={agreed} style={{ width: '22px', height: '22px', flexShrink: 0, accentColor: 'var(--navy)' }}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
        <span>
          I agree to <TermsLinks />, and I understand that photos I upload may be processed by third-party AI
          services that NowStocking doesn't control.
        </span>
      </label>
    </>
  );
}

/** The terms changed since this user last accepted them: accept again before going on. */
export function TermsUpdatePage() {
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/me/terms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accept: true }) });
      await refreshIdentity();
      void sync();
    } catch (e) {
      setError(e instanceof TypeError ? 'Accepting the terms needs a connection.' : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="page stack" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 48px)', maxWidth: '440px' }}>
      <Brand />
      <div class="card stack">
        <strong>We've updated our terms</strong>
        <p class="muted" style={{ margin: 0 }}>Please review them and accept to keep using NowStocking. Everything on this device is kept.</p>
        <TermsAgreement agreed={agreed} onChange={setAgreed} />
        <button class="btn primary lg" disabled={!agreed || busy} onClick={() => void accept()}>{busy ? 'Saving…' : 'Accept and continue'}</button>
      </div>
      {error && <p class="banner bad">{error}</p>}
    </main>
  );
}

function Brand() {
  return (
    <div class="row" style={{ gap: '12px' }}>
      <LogoMark size={44} />
      <div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '30px', lineHeight: 1 }}>
          Now<span style={{ color: 'var(--accent)' }}>Stocking</span>
        </div>
        <div class="meta">Parts inventory · find it, scan it, pull it</div>
      </div>
    </div>
  );
}

function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { route } = useLocation();
  const signup = mode === 'signup';
  const pending = loadPending();
  const [step, setStep] = useState<'email' | 'code'>(pending ? 'code' : 'email');
  const [email, setEmail] = useState(pending ?? '');
  const [name, setName] = useState('');
  const [agreed, setAgreed] = useState(false);
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
        body: JSON.stringify({ email: email.trim(), turnstile: token ?? undefined, signup: signup ? { name: name.trim(), terms: agreed } : undefined }),
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
      <Brand />

      {step === 'email' ? (
        <form class="card stack" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <strong>{signup ? 'Create your account' : 'Sign in'}</strong>
          {signup && (
            <label class="field">
              <span>Name</span>
              <input class="input" autoComplete="name" placeholder="Your name" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
            </label>
          )}
          <label class="field">
            <span>Email</span>
            <input
              class="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" autoCorrect="off"
              placeholder="you@example.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
            />
          </label>
          {signup && <TermsAgreement agreed={agreed} onChange={setAgreed} />}
          {sitekey && <Turnstile sitekey={sitekey} action="signin" onToken={setToken} resetKey={resetKey} onError={setError} />}
          <button
            class="btn primary lg" type="submit"
            disabled={busy || !email.includes('@') || (!!sitekey && !token) || (signup && (!name.trim() || !agreed))}
          >
            {busy ? 'Sending…' : signup ? 'Create account' : 'Email me a code'}
          </button>
          {!signup && (
            <>
              <p class="meta" style={{ margin: 0 }}>No password. If you have an account, we'll email you a 6-digit code.</p>
              <button
                class="btn small" type="button" style={{ alignSelf: 'flex-start' }}
                disabled={!email.includes('@')}
                onClick={() => { savePending(email.trim()); setError(null); setStep('code'); }}
              >I already have a code</button>
            </>
          )}
        </form>
      ) : (
        <form class="card stack" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <strong>Check your email</strong>
          <p class="muted" style={{ margin: 0 }}>
            {signup ? `We sent a 6-digit code to ${email.trim()}.` : `If ${email.trim()} has an account, we've sent it a 6-digit code.`}{' '}
            It works for 10 minutes, and so do any earlier codes you asked for.
          </p>
          <label class="field">
            <span>Code</span>
            <input
              class="input code-input" style={{ letterSpacing: '6px', textAlign: 'center' }}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
              value={code} onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
            />
          </label>
          <button class="btn primary lg" type="submit" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : signup ? 'Create account' : 'Sign in'}</button>
          <div class="row">
            <button class="btn small" type="button" onClick={() => { savePending(null); setStep('email'); setCode(''); }}>Use a different email</button>
            <button class="btn small" type="button" disabled={busy} onClick={() => { setStep('email'); setCode(''); }}>Send a new code</button>
          </div>
        </form>
      )}
      <p class="center" style={{ margin: 0 }}>
        {signup
          ? <>Already have an account? <a href="/signin" onClick={() => savePending(null)}>Sign in</a></>
          : <>New to NowStocking? <a href="/signup" onClick={() => savePending(null)}>Sign up</a></>}
      </p>
      {error && <p class="banner bad">{error}</p>}
      {!signup && (legal.value.terms || legal.value.privacy) && (
        <p class="meta center" style={{ fontSize: '13px', margin: 0 }}>
          By signing in you agree to the {legal.value.terms && <a href={legal.value.terms} target="_blank" rel="noreferrer">Terms</a>}
          {legal.value.terms && legal.value.privacy && ' and '}
          {legal.value.privacy && <a href={legal.value.privacy} target="_blank" rel="noreferrer">Privacy Policy</a>}.
        </p>
      )}
      <p class="meta center" style={{ fontSize: '12px' }}>Version {__APP_VERSION__}</p>
    </main>
  );
}
