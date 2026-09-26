import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { Page } from '../components/chrome';
import { parseLocationCode, Scanner } from '../components/Scanner';

export function ScanPage() {
  const { route } = useLocation();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Page title="Scan">
      <Scanner
        onResult={(text) => {
          const code = parseLocationCode(text);
          if (code) route(`/loc/${encodeURIComponent(code)}`);
          else setMsg(`That isn't a location label: ${text}`);
        }}
      />
      <p class="muted center">Point at a bin or shelf label.</p>
      {msg && <p class="banner warn">{msg}</p>}
      <a class="btn block" href="/locations">Type a location instead</a>
    </Page>
  );
}
