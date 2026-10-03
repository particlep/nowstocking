import type { Release } from '../../shared/changelog';
import { Page } from '../components/chrome';
import { releases, runningVersion } from '../data/changelog';

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function ReleaseList({ list }: { list: Release[] }) {
  return (
    <div class="list">
      {list.map((r) => (
        <div class="list-item">
          <div class="row">
            <strong class="grow">Version {r.version}{r.number === runningVersion ? ' · this one' : ''}</strong>
            <span class="meta">{fmtDate(r.date)}</span>
          </div>
          <ul class="small" style={{ margin: '6px 0 0', paddingLeft: '20px' }}>
            {r.changes.map((c) => <li style={{ marginTop: '3px' }}>{c}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function WhatsNewPage() {
  return (
    <Page title="What's new" back>
      <p class="muted" style={{ margin: 0 }}>You're on version {__APP_VERSION__}.</p>
      <ReleaseList list={releases} />
    </Page>
  );
}
