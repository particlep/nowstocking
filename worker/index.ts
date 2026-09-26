import { Hono } from 'hono';
import { buildCatalog, buildCsv } from '../shared/inventory';
import type { Mutation } from '../shared/schema';
import { TABLE_NAMES } from '../shared/schema';
import { requireAccess, type AppEnv } from './auth';
import { getImportImage, ImportError, parsePage } from './import';
import { applyMutations } from './mutations';
import { readChanges } from './rows';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('cache-control', 'no-store');
});
app.use('*', requireAccess);

app.get('/me', (c) => c.json({ email: c.get('user') }));

app.get('/sync', async (c) => {
  const since = Number(c.req.query('since') ?? 0);
  if (!Number.isSafeInteger(since) || since < 0) return c.json({ error: 'invalid since' }, 400);
  return c.json(await readChanges(c.env.DB, since));
});

app.post('/mutations', async (c) => {
  const body = await c.req.json<{ mutations?: Mutation[] }>().catch(() => null);
  if (!body || !Array.isArray(body.mutations)) return c.json({ error: 'expected { mutations: [] }' }, 400);
  return c.json(await applyMutations(c.env.DB, c.get('user'), body.mutations));
});

app.get('/history/:table/:id', async (c) => {
  const table = c.req.param('table');
  const id = Number(c.req.param('id'));
  if (!TABLE_NAMES.includes(table as never) || !Number.isSafeInteger(id)) return c.json({ error: 'bad request' }, 400);
  // An item's history includes its placements (moves) and consumptions.
  const { results } = await c.env.DB.prepare(
    `SELECT table_name, field, old_value, new_value, changed_by, changed_at FROM change_log
     WHERE (table_name = ?1 AND row_id = ?2)
        OR (?1 = 'items' AND table_name = 'placements' AND row_id IN (SELECT id FROM placements WHERE item_id = ?2))
        OR (?1 = 'items' AND table_name = 'consumptions' AND row_id IN (SELECT id FROM consumptions WHERE item_id = ?2))
     ORDER BY id DESC LIMIT 200`,
  ).bind(table, id).all();
  return c.json({ changes: results });
});

app.post('/import', async (c) => {
  try {
    return c.json(await parsePage(c.env, c.get('user'), await c.req.json()));
  } catch (e) {
    if (e instanceof ImportError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

app.get('/import/image/*', (c) => getImportImage(c.env, c.req.path.replace(/^\/api\/import\/image\//, '')));

app.get('/export.csv', async (c) => {
  const { rows } = await readChanges(c.env.DB, 0);
  const csv = buildCsv(buildCatalog(rows));
  const date = new Date().toISOString().slice(0, 10);
  return c.body(csv, 200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="rv14a-inventory-${date}.csv"`,
  });
});

app.notFound((c) => c.json({ error: 'not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'server error' }, 500);
});

export default app;
