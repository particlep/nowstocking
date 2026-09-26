import { LocationProvider, Route, Router, useLocation } from 'preact-iso';
import { hidesTabs, TabBar } from './components/chrome';
import { PhotoViewer } from './components/PhotoViewer';
import { PullToRefresh } from './components/PullToRefresh';
import { syncError, syncState } from './data/store';
import { authMode, warehouseId } from './data/workspace';
import { MembersPage } from './pages/Members';
import { SignInPage } from './pages/SignIn';
import { signIn } from './data/sync';
import { AddItemPage } from './pages/AddItem';
import { ImportListPage } from './pages/Import';
import { ImportJobPage } from './pages/ImportJob';
import { ImportRowPage } from './pages/ImportRow';
import { InstructionReviewPage } from './pages/InstructionReview';
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
import { WarehouseLocationPage } from './pages/WarehouseLocation';
import { WarehousesPage } from './pages/Warehouses';
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
  const show = warehouseId.value || path === '/signin';
  return <div class={`app${hidesTabs(path) ? ' no-tabs' : ''}`}>{show ? children : <FirstRun />}</div>;
}

/** Before this phone has ever loaded a warehouse. */
function FirstRun() {
  const state = syncState.value;
  if (state === 'signin' && authMode.value === 'email') return <SignInPage />;
  return (
    <main class="page stack" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 48px)', textAlign: 'center' }}>
      <h1 class="large-title">NowStocking</h1>
      {state === 'offline' && <p class="muted">Connect to the internet once to load your warehouse. After that it works offline.</p>}
      {state === 'signin' && <button class="btn primary" onClick={signIn}>Sign in</button>}
      {state === 'error' && <p class="banner bad">{syncError.value}</p>}
      {(state === 'idle' || state === 'syncing') && <p class="muted">Loading your warehouse…</p>}
    </main>
  );
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
          <Route path="/w/:wid/loc/:code" component={WarehouseLocationPage} />
          <Route path="/warehouses" component={WarehousesPage} />
          <Route path="/members" component={MembersPage} />
          <Route path="/signin" component={SignInPage} />
          <Route path="/item/new" component={AddItemPage} />
          <Route path="/item/:id" component={ItemDetailPage} />
          <Route path="/putaway" component={PutAwayPage} />
          <Route path="/receive" component={ReceivingListPage} />
          <Route path="/receive/:kit" component={ReceivingKitPage} />
          <Route path="/pick" component={PickListsPage} />
          <Route path="/pick/photos/:id" component={InstructionReviewPage} />
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
        <PhotoViewer />
      </Shell>
    </LocationProvider>
  );
}
