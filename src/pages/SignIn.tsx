import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { LogoMark } from '../components/icons';
import { api } from '../data/api';
import { sync } from '../data/sync';
import { refreshIdentity } from '../data/workspace';

/** Email one-time-code sign-in (installs with AUTH_MODE = "email"). */
export function SignInPage() {
  const { route } = useLocation();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    await api('/api/auth/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
    setStep('code');
  });

  const verify = () => run(async () => {
    await api('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim(), code }) });
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
          <button class="btn primary lg" type="submit" disabled={busy || !email.includes('@')}>{busy ? 'Sending…' : 'Email me a code'}</button>
          <p class="meta" style={{ margin: 0 }}>No password. New here? Signing in creates your workshop.</p>
        </form>
      ) : (
        <form class="card stack" onSubmit={(e) => { e.preventDefault(); void verify(); }}>
          <strong>Check your email</strong>
          <p class="muted" style={{ margin: 0 }}>We sent a 6-digit code to {email.trim()}.</p>
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
            <button class="btn small" type="button" onClick={() => { setStep('email'); setCode(''); }}>Use a different email</button>
            <button class="btn small" type="button" disabled={busy} onClick={send}>Send a new code</button>
          </div>
        </form>
      )}
      {error && <p class="banner bad">{error}</p>}
    </main>
  );
}
