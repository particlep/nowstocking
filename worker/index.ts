import { Hono, type Context } from 'hono';
import { WAREHOUSE_ID, canManage } from '../shared/directory';
import type { ImportKind } from '../shared/importTypes';
import { TABLE_NAMES, type Mutation, type TableName } from '../shared/schema';
import { requireAccess, type AppEnv } from './auth';
import {
  accountRole, archiveWarehouse, createWarehouse, describe, provision, renameWarehouse, warehouseRole,
} from './directory';
import { emailLabels, EmailError } from './email';
import { getImportImage, IMAGE_TYPES, JOB_ID, MAX_IMAGE_BYTES, type ImageType } from './import';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
});
app.use('*', requireAccess);

/** Durable Object errors cross RPC as "404: message". Turn them back into HTTP responses. */
function fromRpcError(c: Context<AppEnv>, e: unknown) {
  const m = e instanceof Error ? /^(400|404|409): (.*)$/s.exec(e.message) : null;
  if (m) return c.json({ error: m[2] }, Number(m[1]) as 400 | 404 | 409);
  throw e;
}

// ---- Directory ----

/** Who am I, and which warehouses can I open? Also signs new users up. */
app.get('/me', async (c) => {
  const mode = (c.env.SIGNUP_MODE as string) === 'open' ? 'open' : 'single';
  const userId = await provision(c.env.DB, c.get('email'), mode);
  return c.json(await describe(c.env.DB, userId, c.get('email')));
});

app.post('/accounts/:accountId/warehouses', async (c) => {
  const role = await accountRole(c.env.DB, c.get('email'), c.req.param('accountId'));
  if (!role) return c.json({ error: 'not found' }, 404);
  if (!canManage(role)) return c.json({ error: 'Only owners and admins can add warehouses.' }, 403);
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = body.name?.trim().slice(0, 80);
  if (!name) return c.json({ error: 'A name is required.' }, 400);
  return c.json({ id: await createWarehouse(c.env.DB, c.req.param('accountId'), name) });
});

// ---- One warehouse: /api/w/:wid/... ----

const w = new Hono<AppEnv>();

w.use('*', async (c, next) => {
  const wid = c.req.param('wid') ?? '';
  if (!WAREHOUSE_ID.test(wid)) return c.json({ error: 'not found' }, 404);
  const access = await warehouseRole(c.env.DB, c.get('email'), wid);
  if (!access) return c.json({ error: 'not found' }, 404);
  const stub = c.env.WAREHOUSE.get(c.env.WAREHOUSE.idFromName(wid));
  c.set('warehouse', { id: wid, role: access.role, accountId: access.account_id, stub });
  return next();
});

w.patch('/', async (c) => {
  const { id, role } = c.get('warehouse');
  if (!canManage(role)) return c.json({ error: 'Only owners and admins can rename warehouses.' }, 403);
  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  const name = body.name?.trim().slice(0, 80);
  if (!name) return c.json({ error: 'A name is required.' }, 400);
  await renameWarehouse(c.env.DB, id, name);
  return c.json({ ok: true });
});

w.delete('/', async (c) => {
  const { id, role, accountId } = c.get('warehouse');
  if (role !== 'owner') return c.json({ error: 'Only the owner can archive a warehouse.' }, 403);
  if (!(await archiveWarehouse(c.env.DB, id, accountId))) return c.json({ error: "You can't archive your only warehouse." }, 409);
  return c.json({ ok: true });
});

w.get('/sync', async (c) => {
  const since = Number(c.req.query('since') ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) return c.json({ error: 'invalid since' }, 400);
  return c.json(await c.get('warehouse').stub.sync(since));
});

w.post('/mutations', async (c) => {
  const body = await c.req.json<{ mutations?: Mutation[] }>().catch(() => null);
  if (!body || !Array.isArray(body.mutations)) return c.json({ error: 'expected { mutations: [] }' }, 400);
  return c.json(await c.get('warehouse').stub.mutate(c.get('email'), body.mutations));
});

w.get('/history/:table/:id', async (c) => {
  const table = c.req.param('table') as TableName;
  const id = Number(c.req.param('id'));
  if (!TABLE_NAMES.includes(table) || !Number.isSafeInteger(id)) return c.json({ error: 'bad request' }, 400);
  return c.json({ changes: await c.get('warehouse').stub.history(table, id) });
});

w.get('/export.csv', async (c) => {
  const csv = await c.get('warehouse').stub.exportCsv();
  const date = new Date().toISOString().slice(0, 10);
  return c.body(csv, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="inventory-${date}.csv"`,
  });
});

// Photo imports (packing lists and plans pages), read in the background by a Workflow.

const withJob = async (c: Context<AppEnv>, fn: (jobId: string) => Promise<Response>) => {
  const jobId = c.req.param('id') ?? '';
  if (!JOB_ID.test(jobId)) return c.json({ error: 'bad import id' }, 400);
  try {
    return await fn(jobId);
  } catch (e) {
    return fromRpcError(c, e);
  }
};

w.get('/import/jobs', async (c) => {
  const kind: ImportKind = c.req.query('kind') === 'instructions' ? 'instructions' : 'packing_list';
  return c.json({ jobs: await c.get('warehouse').stub.listJobs(kind) });
});

w.post('/import/jobs', async (c) => {
  type Body = { page_count?: number; kind?: ImportKind; title?: string };
  const body = await c.req.json<Body>().catch(() => ({}) as Body);
  try {
    const title = typeof body.title === 'string' ? body.title : null;
    const id = await c.get('warehouse').stub.createJob(c.get('email'), Number(body.page_count), body.kind ?? 'packing_list', title);
    return c.json({ id });
  } catch (e) {
    return fromRpcError(c, e);
  }
});

w.get('/import/jobs/:id', (c) => withJob(c, async (id) => c.json(await c.get('warehouse').stub.getJob(id))));

w.put('/import/jobs/:id/pages/:page', (c) =>
  withJob(c, async (jobId) => {
    const page = Number(c.req.param('page'));
    const type = (c.req.header('content-type') ?? '').split(';')[0].trim() as ImageType;
    if (!IMAGE_TYPES.includes(type)) return c.json({ error: 'unsupported image type' }, 400);
    const body = await c.req.arrayBuffer();
    if (!body.byteLength || body.byteLength > MAX_IMAGE_BYTES) return c.json({ error: 'image is empty or too large' }, 400);
    const { id: wid, stub } = c.get('warehouse');
    const key = await stub.pageUploadKey(wid, jobId, page, type.split('/')[1]);
    await c.env.IMPORTS.put(key, body, { httpMetadata: { contentType: type } });
    await stub.pageUploaded(jobId, page, key);
    return c.json({ ok: true });
  }),
);

w.post('/import/jobs/:id/start', (c) =>
  withJob(c, async (jobId) => {
    const body = await c.req.json<{ pages?: number[] }>().catch(() => ({}) as { pages?: number[] });
    const { id: wid, stub } = c.get('warehouse');
    const pages = await stub.startReading(jobId, Array.isArray(body.pages) ? body.pages.map(Number) : undefined);
    try {
      await c.env.IMPORT_WORKFLOW.create({ id: `${jobId}-${Date.now()}`, params: { warehouseId: wid, jobId, pages } });
    } catch (e) {
      await stub.cancelReading(jobId, pages);
      throw e;
    }
    return c.json(await stub.getJob(jobId));
  }),
);

w.post('/import/jobs/:id/committed', (c) =>
  withJob(c, async (id) => {
    await c.get('warehouse').stub.markCommitted(id);
    return c.json({ ok: true });
  }),
);

w.delete('/import/jobs/:id', (c) =>
  withJob(c, async (jobId) => {
    const listed = await c.env.IMPORTS.list({ prefix: `w/${c.get('warehouse').id}/imports/${jobId}/` });
    if (listed.objects.length) await c.env.IMPORTS.delete(listed.objects.map((o) => o.key));
    await c.get('warehouse').stub.deleteJob(jobId);
    return c.json({ ok: true });
  }),
);

w.get('/import/image/*', (c) => {
  const key = c.req.path.replace(/^\/api\/w\/[^/]+\/import\/image\//, '');
  return getImportImage(c.env, c.get('warehouse').id, key);
});

app.route('/w/:wid', w);

// ---- Account-wide ----

app.post('/email/labels', async (c) => {
  try {
    return c.json(await emailLabels(c.env, await c.req.formData(), c.get('email')));
  } catch (e) {
    if (e instanceof EmailError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server error' }, 500);
});

export { ImportWorkflow } from './importWorkflow';
export { Warehouse } from './warehouse/Warehouse';

export default app;
