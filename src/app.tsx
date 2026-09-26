import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { hidesTabs, TabBar } from './components/chrome';
import { PullToRefresh } from './components/PullToRefresh';
import { syncState } from './data/store';
import { signIn } from './data/sync';
import { AddItemPage } from './pages/AddItem';
import { ImportListPage } from './pages/Import';
import { ImportJobPage } from './pages/ImportJob';
import { ImportRowPage } from './pages/ImportRow';
import { ItemDetailPage } from './pages/ItemDetail';
import { LabelsPage } from './pages/Labels';
import { LocationDetailPage } from './pages/LocationDetail';
import { LocationsPage } from './pages/Locations';
import { MorePage } from './pages/More';
import { PickListDetailPage, PickListsPage } from './pages/PickLists';
import { PutAwayPage } from './pages/PutAway';
import { ReceivingKitPage, ReceivingListPage } from './pages/Receiving';
import { ScanPage } from './pages/Scan';
import { SearchPage } from './pages/Search';
import { SettingsPage } from './pages/Settings';

function SignInBanner() {
  if (syncState.value !== 'signin') return null;
  return (
    <div class="banner bad row" style={{ margin: 'calc(env(safe-area-inset-top) + 8px) 16px 0', alignItems: 'center' }}>
      <span class="grow small">Sign-in expired. Your edits are saved on this phone.</span>
      <button class="btn small primary" onClick={signIn}>Sign in</button>
    </div>
  );
}

function Shell({ children }: { children: preact.ComponentChildren }) {
  const { path } = useLocation();
  return <div class={`app${hidesTabs(path) ? ' no-tabs' : ''}`}>{children}</div>;
}

export function App() {
  return (
    <LocationProvider>
      <Shell>
        <PullToRefresh />
        <SignInBanner />
        <Router>
          <Route path="/" component={SearchPage} />
          <Route path="/scan" component={ScanPage} />
          <Route path="/loc/:code" component={LocationDetailPage} />
          <Route path="/item/new" component={AddItemPage} />
          <Route path="/item/:id" component={ItemDetailPage} />
          <Route path="/putaway" component={PutAwayPage} />
          <Route path="/receive" component={ReceivingListPage} />
          <Route path="/receive/:kit" component={ReceivingKitPage} />
          <Route path="/pick" component={PickListsPage} />
          <Route path="/pick/:id" component={PickListDetailPage} />
          <Route path="/import" component={ImportListPage} />
          <Route path="/import/:id" component={ImportJobPage} />
          <Route path="/import/:id/row/:key" component={ImportRowPage} />
          <Route path="/locations" component={LocationsPage} />
          <Route path="/labels" component={LabelsPage} />
          <Route path="/settings" component={SettingsPage} />
          <Route path="/more" component={MorePage} />
          <Route default component={SearchPage} />
        </Router>
        <TabBar />
      </Shell>
    </LocationProvider>
  );
}
