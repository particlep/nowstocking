import { useEffect, useState } from 'preact/hooks';
import { useRoute } from 'preact-iso';
import { Page } from '../components/chrome';
import { sync } from '../data/sync';
import { allWarehouses, identity, openWarehouse, warehouseId } from '../data/workspace';
import { LocationDetailPage } from './LocationDetail';

/** /w/<warehouse>/loc/<code>, what labels encode. Opens that warehouse first if needed. */
export function WarehouseLocationPage() {
  const { params } = useRoute();
  const wid = params.wid ?? '';
  const known = allWarehouses.value.some((w) => w.id === wid);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (known && wid !== warehouseId.value && !switching) {
      setSwitching(true);
      void openWarehouse(wid).then(() => { setSwitching(false); void sync(); });
    }
  }, [known, wid]);

  if (wid === warehouseId.value) return <LocationDetailPage />;
  if (!identity.value || switching) return <Page back><p class="muted center">Opening…</p></Page>;
  return (
    <Page back>
      <p class="banner warn">This label belongs to a warehouse you don't have access to.</p>
    </Page>
  );
}
