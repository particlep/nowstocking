import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import type { MeResponse } from '../shared/directory';
import type { Mutation, MutationsResponse, Op, SyncResponse } from '../shared/schema';
import app from '../worker/index';

const BASE = 'https://parts.example.com';
const OPEN = { ...env, SIGNUP_MODE: 'open' } as unknown as Env;

let seq = 0;
const email = (name: string) => `${name}-${++seq}@example.com`;
const nextId = () => 2 ** 33 + ++seq;

async function call<T>(user: string, path: string, init: RequestInit = {}, e: Env = env) {
  const headers = new Headers(init.headers);
  headers.set('X-Dev-User', user);
  const res = await app.fetch(new Request(BASE + path, { ...init, headers }), e);
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: (type.includes('json') ? await res.json() : await res.text()) as T };
}

const json = (body: unknown, method = 'POST'): RequestInit => ({
  method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

function mutation(label: string, ops: Op[]): Mutation {
  return { id: crypto.randomUUID(), label, created_at: new Date().toISOString(), ops };
}

/** A user with their own account and warehouse ("open" sign-up, as on the hosted service). */
async function newOwner(name = 'owner') {
  const user = email(name);
  const me = (await call<MeResponse>(user, '/api/me', {}, OPEN)).body;
  const account = me.accounts[0];
  return { user, account, wid: account.warehouses[0].id };
}

async function mutate(user: string, wid: string, mutations: Mutation[]) {
  return call<MutationsResponse>(user, `/api/w/${wid}/mutations`, json({ mutations }));
}

async function sync(user: string, wid: string, since = 0) {
  return (await call<SyncResponse>(user, `/api/w/${wid}/sync?since=${since}`)).body;
}

/** A kit with one bag in a bin and one counted part in the bag. */
async function seed(user: string, wid: string) {
  const kit = nextId(), bag = nextId(), part = nextId(), bin = nextId(), pl = nextId();
  const setup = mutation('setup', [
    { op: 'insert', table: 'kits', id: kit, fields: { code: 'EMP', name: 'Empennage kit' } },
    { op: 'insert', table: 'locations', id: bin, fields: { code: 'b03', type: 'bin' } },
    { op: 'insert', table: 'items', id: bag, fields: { kit_id: kit, item_type: 'bag', stock_code: 'BAG 1118', qty: 1, unit: 'ea', sort_order: 1 } },
    { op: 'insert', table: 'items', id: part, fields: { kit_id: kit, parent_id: bag, item_type: 'part', stock_code: 'LP4-3', qty: 225, unit: 'ea', sort_order: 2 } },
    { op: 'insert', table: 'placements', id: pl, fields: { item_id: bag, location_id: bin } },
  ]);
  const res = await mutate(user, wid, [setup]);
  expect(res.body.results[0]).toMatchObject({ status: 'applied' });
  return { kit, bag, part, bin, pl, setup };
}

describe('sign-in', () => {
  it('refuses every request when neither Access nor a dev user is configured', async () => {
    const bare = { ...env, DEV_USER_EMAIL: undefined } as unknown as Env;
    expect((await app.fetch(new Request(`${BASE}/api/me`), bare)).status).toBe(500);
  });

  it('rejects a request with Access configured but no token', async () => {
    const withAccess = { ...env, ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud' } as unknown as Env;
    expect((await app.fetch(new Request(`${BASE}/api/me`), withAccess)).status).toBe(401);
  });
});

describe('accounts and warehouses', () => {
  it('self-hosted: the first person owns the one account and everyone else joins it', async () => {
    const first = email('first');
    const a = (await call<MeResponse>(first, '/api/me')).body;
    const b = (await call<MeResponse>(email('partner'), '/api/me')).body;
    expect(b.accounts.map((x) => x.id)).toEqual([a.accounts[0].id]);
    expect(b.accounts[0].role).toBe('member');
    expect(b.accounts[0].warehouses).toEqual(a.accounts[0].warehouses);
  });

  it('hosted: each new user gets their own account and a first warehouse', async () => {
    const { account } = await newOwner();
    expect(account.role).toBe('owner');
    expect(account.warehouses).toHaveLength(1);
    expect(account.warehouses[0].id).toMatch(/^[a-z0-9]{10}$/);
  });

  it("keeps each account out of other accounts' warehouses", async () => {
    const a = await newOwner('a');
    const b = await newOwner('b');
    await seed(a.user, a.wid);
    expect((await call(b.user, `/api/w/${a.wid}/sync`)).status).toBe(404);
    expect((await mutate(b.user, a.wid, [mutation('x', [])])).status).toBe(404);
    expect((await call(b.user, `/api/w/${a.wid}/export.csv`)).status).toBe(404);
  });

  it('lets owners add, rename and archive warehouses, each with its own inventory', async () => {
    const { user, account, wid } = await newOwner();
    const created = await call<{ id: string }>(user, `/api/accounts/${account.id}/warehouses`, json({ name: 'Boat build' }));
    expect(created.status).toBe(200);
    const second = created.body.id;

    await seed(user, wid);
    await seed(user, second); // the same location code in another warehouse is fine
    const first = await sync(user, wid);
    const other = await sync(user, second);
    expect(first.rows.items).toHaveLength(2);
    expect(other.rows.items).toHaveLength(2);
    expect(new Set(first.rows.items.map((i) => i.id))).not.toEqual(new Set(other.rows.items.map((i) => i.id)));

    expect((await call(user, `/api/w/${second}`, json({ name: 'Boat' }, 'PATCH'))).status).toBe(200);
    expect((await call(user, `/api/w/${second}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(user, `/api/w/${second}/sync`)).status).toBe(404);
    // The last warehouse can't be archived.
    expect((await call(user, `/api/w/${wid}`, { method: 'DELETE' })).status).toBe(409);
  });

  it("doesn't let members add warehouses", async () => {
    const owner = email('owner');
    const me = (await call<MeResponse>(owner, '/api/me')).body;
    const member = email('member');
    await call(member, '/api/me');
    const res = await call(member, `/api/accounts/${me.accounts[0].id}/warehouses`, json({ name: 'Nope' }));
    expect(res.status).toBe(403);
  });
});

describe('mutations and sync', () => {
  it('computes the search key and normalizes location codes on the server', async () => {
    const { user, wid } = await newOwner();
    const s = await seed(user, wid);
    const rows = (await sync(user, wid)).rows;
    expect(rows.items.find((i) => i.id === s.part)?.search_key).toBe('LP43');
    expect(rows.locations.find((l) => l.id === s.bin)?.code).toBe('B03');
    expect(rows.kits.map((k) => k.code).sort()).toEqual(['EMP', 'MISC']);
  });

  it('applies a mutation id at most once', async () => {
    const { user, wid } = await newOwner();
    const s = await seed(user, wid);
    expect((await mutate(user, wid, [s.setup])).body.results[0].status).toBe('duplicate');
  });

  it('keeps both edits when two people change different fields of one item', async () => {
    const { user, wid } = await newOwner();
    const s = await seed(user, wid);
    const { version } = await sync(user, wid);
    const res = await mutate(user, wid, [
      mutation('status', [{ op: 'update', table: 'items', id: s.part, fields: { status: 'received' } }]),
      mutation('notes', [{ op: 'update', table: 'items', id: s.part, fields: { notes: 'short 2' } }]),
    ]);
    expect(res.body.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    const changed = await sync(user, wid, version);
    const part = changed.rows.items.find((i) => i.id === s.part)!;
    expect(part).toMatchObject({ status: 'received', notes: 'short 2', updated_by: user });
    expect(changed.version).toBeGreaterThan(version);
  });

  it('rejects bad edits without blocking good ones, and rolls a rejected edit back completely', async () => {
    const { user, wid } = await newOwner();
    const s = await seed(user, wid);
    const res = await mutate(user, wid, [
      mutation('bad status', [{ op: 'update', table: 'items', id: s.part, fields: { status: 'lost' } }]),
      mutation('server field', [{ op: 'update', table: 'items', id: s.part, fields: { version: 99 } }]),
      mutation('missing row', [{ op: 'update', table: 'items', id: 12345, fields: { notes: 'x' } }]),
      mutation('unknown table', [{ op: 'update', table: 'users' as never, id: s.part, fields: {} }]),
      mutation('half good', [
        { op: 'update', table: 'items', id: s.part, fields: { notes: 'should not stick' } },
        { op: 'insert', table: 'locations', id: nextId(), fields: { code: 'B03', type: 'bin' } }, // duplicate code
      ]),
      mutation('good', [{ op: 'update', table: 'items', id: s.part, fields: { notes: 'ok' } }]),
    ]);
    expect(res.body.results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'applied']);
    expect((await sync(user, wid)).rows.items.find((i) => i.id === s.part)?.notes).toBe('ok');
  });

  it('sends deletes to other devices as tombstones', async () => {
    const { user, wid } = await newOwner();
    const s = await seed(user, wid);
    const { version } = await sync(user, wid);
    await mutate(user, wid, [mutation('move out', [{ op: 'delete', table: 'placements', id: s.pl }])]);
    expect((await sync(user, wid, version)).rows.placements.find((p) => p.id === s.pl)?.deleted_at).toBeTruthy();
    expect((await sync(user, wid)).rows.placements.some((p) => p.id === s.pl)).toBe(false);
  });

  it('applies a large import in one request', async () => {
    const { user, wid } = await newOwner();
    const kit = nextId();
    const ops: Op[] = [{ op: 'insert', table: 'kits', id: kit, fields: { code: 'BIG', name: 'Big kit' } }];
    for (let i = 0; i < 600; i++) {
      ops.push({ op: 'insert', table: 'items', id: nextId(), fields: { kit_id: kit, item_type: 'part', stock_code: `P-${i}`, qty: 1, unit: 'ea', sort_order: i } });
    }
    const many = Array.from({ length: 50 }, (_, i) => mutation(`m${i}`, [{ op: 'update', table: 'kits', id: kit, fields: { name: `n${i}` } }]));
    const res = await mutate(user, wid, [mutation('import', ops), ...many]);
    expect(res.body.results).toHaveLength(51);
    expect(res.body.results.every((r) => r.status === 'applied')).toBe(true);
    expect((await sync(user, wid)).rows.items).toHaveLength(600);
  });

  it('records a field-level history for an item, including its moves', async () => {
    const { user, wid } = await newOwner();
    const s = await seed(user, wid);
    await mutate(user, wid, [mutation('receive', [{ op: 'update', table: 'items', id: s.part, fields: { status: 'received' } }])]);
    await mutate(user, wid, [mutation('place', [{ op: 'insert', table: 'placements', id: nextId(), fields: { item_id: s.part, location_id: s.bin } }])]);
    const { body } = await call<{ changes: { table_name: string; field: string; new_value: string | null }[] }>(user, `/api/w/${wid}/history/items/${s.part}`);
    expect(body.changes.some((c) => c.table_name === 'items' && c.field === 'status' && c.new_value === 'received')).toBe(true);
    expect(body.changes.some((c) => c.table_name === 'placements' && c.field === '_created')).toBe(true);
  });

  it('exports items with their effective location', async () => {
    const { user, wid } = await newOwner();
    await seed(user, wid);
    const res = await call<string>(user, `/api/w/${wid}/export.csv`);
    expect(res.body).toContain('EMP,,BAG 1118,part,LP4-3,,225,ea,0,225,expected,,B03,BAG 1118');
  });
});

describe('photo imports', () => {
  it('stores photos per warehouse and serves them only to that warehouse', async () => {
    const a = await newOwner('a');
    const b = await newOwner('b');
    const job = await call<{ id: string }>(a.user, `/api/w/${a.wid}/import/jobs`, json({ page_count: 2, kind: 'instructions', title: 'Aft deck' }));
    expect(job.status).toBe(200);
    const jobId = job.body.id;

    const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const put = await call(a.user, `/api/w/${a.wid}/import/jobs/${jobId}/pages/1`, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: photo });
    expect(put.status).toBe(200);

    const got = await call<{ title: string; pages: { status: string; image_key: string | null }[] }>(a.user, `/api/w/${a.wid}/import/jobs/${jobId}`);
    expect(got.body.title).toBe('Aft deck');
    expect(got.body.pages.map((p) => p.status)).toEqual(['uploaded', 'waiting']);
    const key = got.body.pages[0].image_key!;
    expect(key.startsWith(`w/${a.wid}/imports/${jobId}/`)).toBe(true);

    const img = await app.fetch(new Request(`${BASE}/api/w/${a.wid}/import/image/${key}`, { headers: { 'X-Dev-User': a.user } }), env);
    expect(img.status).toBe(200);
    expect(new Uint8Array(await img.arrayBuffer())).toEqual(photo);

    // Another account can't see the job or the photo, even with the right key.
    expect((await call(b.user, `/api/w/${a.wid}/import/jobs/${jobId}`)).status).toBe(404);
    expect((await call(b.user, `/api/w/${b.wid}/import/image/${key}`)).status).toBe(404);

    const list = await call<{ jobs: { id: string; title: string }[] }>(a.user, `/api/w/${a.wid}/import/jobs?kind=instructions`);
    expect(list.body.jobs.map((j) => j.id)).toContain(jobId);

    expect((await call(a.user, `/api/w/${a.wid}/import/jobs/${jobId}/start`, json({ pages: [2] }))).status).toBe(409); // no photo yet
    expect((await call(a.user, `/api/w/${a.wid}/import/jobs/${jobId}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(a.user, `/api/w/${a.wid}/import/jobs/${jobId}`)).status).toBe(404);
  });
});
