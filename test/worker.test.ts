import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Mutation, MutationsResponse, Op, SyncResponse } from '../shared/schema';
import app from '../worker/index';

const BASE = 'https://parts.example.com';

function mutation(label: string, ops: Op[]): Mutation {
  return { id: crypto.randomUUID(), label, created_at: new Date().toISOString(), ops };
}

async function call<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await app.fetch(new Request(BASE + path, init), env);
  return { status: res.status, body: (await res.json()) as T };
}

async function post(mutations: Mutation[]) {
  return call<MutationsResponse>('/api/mutations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mutations }),
  });
}

async function sync(since = 0) {
  return (await call<SyncResponse>(`/api/sync?since=${since}`)).body;
}

let n = 0;
const nextId = () => 2 ** 33 + ++n;

/** A kit with one bag in bin B03 and one counted part in the bag. */
async function seed() {
  const kit = nextId(), bag = nextId(), part = nextId(), bin = nextId(), pl = nextId();
  const setup = mutation('setup', [
    { op: 'insert', table: 'kits', id: kit, fields: { code: `K${kit}`, name: 'Test kit' } },
    { op: 'insert', table: 'locations', id: bin, fields: { code: `b${bin}`, type: 'bin' } },
    { op: 'insert', table: 'items', id: bag, fields: { kit_id: kit, item_type: 'bag', stock_code: 'BAG 1118', qty: 1, unit: 'ea', sort_order: 1 } },
    { op: 'insert', table: 'items', id: part, fields: { kit_id: kit, parent_id: bag, item_type: 'part', stock_code: 'LP4-3', qty: 225, unit: 'ea', sort_order: 2 } },
    { op: 'insert', table: 'placements', id: pl, fields: { item_id: bag, location_id: bin } },
  ]);
  const res = await post([setup]);
  expect(res.body.results[0].status).toBe('applied');
  return { kit, bag, part, bin, pl, setup };
}

describe('auth', () => {
  it('runs as the dev user when Access is not configured', async () => {
    const res = await call<{ email: string }>('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@example.com');
  });

  it('refuses every request when neither Access nor a dev user is configured', async () => {
    const bare = { ...env, DEV_USER_EMAIL: undefined } as unknown as Env;
    const res = await app.fetch(new Request(`${BASE}/api/me`), bare);
    expect(res.status).toBe(500);
  });

  it('rejects a request with Access configured but no token', async () => {
    const withAccess = { ...env, ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', ACCESS_AUD: 'aud' } as unknown as Env;
    const res = await app.fetch(new Request(`${BASE}/api/me`), withAccess);
    expect(res.status).toBe(401);
  });
});

describe('mutations and sync', () => {
  let s: Awaited<ReturnType<typeof seed>>;
  beforeEach(async () => {
    s = await seed();
  });

  it('computes the search key and normalizes location codes on the server', async () => {
    const rows = (await sync()).rows;
    expect(rows.items.find((i) => i.id === s.part)?.search_key).toBe('LP43');
    expect(rows.locations.find((l) => l.id === s.bin)?.code).toBe(`B${s.bin}`);
  });

  it('applies a mutation id at most once', async () => {
    const res = await post([s.setup]);
    expect(res.body.results[0].status).toBe('duplicate');
  });

  it('keeps both edits when two devices change different fields of one item', async () => {
    const { version } = await sync();
    const a = mutation('status', [{ op: 'update', table: 'items', id: s.part, fields: { status: 'received' } }]);
    const b = mutation('notes', [{ op: 'update', table: 'items', id: s.part, fields: { notes: 'short 2' } }]);
    const res = await post([a, b]);
    expect(res.body.results.map((r) => r.status)).toEqual(['applied', 'applied']);

    const changed = await sync(version);
    const part = changed.rows.items.find((i) => i.id === s.part)!;
    expect(part.status).toBe('received');
    expect(part.notes).toBe('short 2');
    expect(part.updated_by).toBe('test@example.com');
    expect(changed.version).toBeGreaterThan(version);
  });

  it('rejects bad edits without blocking the good ones', async () => {
    const bad = [
      mutation('bad status', [{ op: 'update', table: 'items', id: s.part, fields: { status: 'lost' } }]),
      mutation('server field', [{ op: 'update', table: 'items', id: s.part, fields: { version: 99 } }]),
      mutation('missing row', [{ op: 'update', table: 'items', id: 12345, fields: { notes: 'x' } }]),
      mutation('unknown table', [{ op: 'update', table: 'users' as never, id: s.part, fields: {} }]),
    ];
    const good = mutation('good', [{ op: 'update', table: 'items', id: s.part, fields: { notes: 'ok' } }]);
    const res = await post([...bad, good]);
    expect(res.body.results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'applied']);
  });

  it('rejects an insert that breaks a uniqueness rule', async () => {
    const dupe = mutation('dupe bin', [{ op: 'insert', table: 'locations', id: nextId(), fields: { code: `B${s.bin}`, type: 'bin' } }]);
    expect((await post([dupe])).body.results[0].status).toBe('rejected');
  });

  it('sends deletes to other devices as tombstones', async () => {
    const { version } = await sync();
    await post([mutation('move out', [{ op: 'delete', table: 'placements', id: s.pl }])]);
    const changed = await sync(version);
    expect(changed.rows.placements.find((p) => p.id === s.pl)?.deleted_at).toBeTruthy();
    // A fresh device never sees the deleted row at all.
    expect((await sync(0)).rows.placements.some((p) => p.id === s.pl)).toBe(false);
  });

  it('records a field-level history for an item, including its moves', async () => {
    await post([mutation('receive', [{ op: 'update', table: 'items', id: s.part, fields: { status: 'received' } }])]);
    await post([mutation('place', [{ op: 'insert', table: 'placements', id: nextId(), fields: { item_id: s.part, location_id: s.bin } }])]);
    const { body } = await call<{ changes: { table_name: string; field: string; new_value: string | null }[] }>(`/api/history/items/${s.part}`);
    expect(body.changes.some((c) => c.table_name === 'items' && c.field === 'status' && c.new_value === 'received')).toBe(true);
    expect(body.changes.some((c) => c.table_name === 'placements' && c.field === '_created')).toBe(true);
  });

  it('stops short of the D1 query limit and lets the client resend the rest', async () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      mutation(`note ${i}`, [{ op: 'update', table: 'items', id: s.part, fields: { notes: `n${i}` } }]));
    const first = await post(many);
    expect(first.body.results.length).toBeGreaterThan(0);
    expect(first.body.results.length).toBeLessThan(30);
    expect(first.body.results.every((r) => r.status === 'applied')).toBe(true);

    const rest = many.slice(first.body.results.length);
    let applied = first.body.results.length;
    for (let round = 0; round < 10 && applied < 30; round++) {
      const res = await post(many.slice(applied));
      applied += res.body.results.length;
    }
    expect(applied).toBe(30);
    expect(rest.length).toBeGreaterThan(0);
  });
});

describe('CSV export', () => {
  it('exports items with their effective location', async () => {
    const s = await seed();
    const res = await app.fetch(new Request(`${BASE}/api/export.csv`), env);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const csv = await res.text();
    expect(csv).toContain(`K${s.kit},,BAG 1118,part,LP4-3,,225,ea,0,225,expected,,B${s.bin},BAG 1118`);
  });
});
