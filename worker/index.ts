import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { WAREHOUSE_ID, canManage, type Role } from '../shared/directory';
import type { ImportKind } from '../shared/importTypes';
import { TABLE_NAMES, type Mutation, type TableName } from '../shared/schema';
import { authMode, requireAccess, type AppEnv } from './auth';
import {
  accountRole, archiveWarehouse, createWarehouse, describe, provision, renameWarehouse, warehouseRole,
} from './directory';
import { DeleteBlocked, deleteUser } from './deleteAccount';
import { emailLabels, EmailError } from './email';
import { getImportImage, IMAGE_TYPES, JOB_ID, MAX_IMAGE_BYTES, type ImageType } from './import';
import { cancelInvite, invite, listMembers, MemberError, removeMember, renameAccount, setRole } from './members';
import { AuthError, EMAIL_RE, endSession, SESSION_COOKIE, SESSION_MAX_AGE, startLogin, verifyLogin } from './session';
import { turnstileSitekey, verifyTurnstile } from './turnstile';
import { getUsage, recordPhotoPages } from './usage';
import { aiStatus, assertAiAllowed, operatorEmails } from './aiBudget';
import { admin } from './admin';

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

// ---- Sign-in (AUTH_MODE = "email") ----

app.get('/auth/config', (c) => {
  const env = c.env as { TERMS_URL?: string; PRIVACY_URL?: string };
  return c.json({
    mode: authMode(c.env),
    turnstileSitekey: turnstileSitekey(c.env),
    terms: env.TERMS_URL || null,
    privacy: env.PRIVACY_URL || null,
  });
});

/** 10 sign-in requests a minute per IP, so the form can't be used to flood inboxes or guess codes. */
app.use('/auth/:step{start|verify}', async (c, next) => {
  const limiter = (c.env as { AUTH_LIMITER?: RateLimit }).AUTH_LIMITER;
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (limiter && !(await limiter.limit({ key: ip })).success) {
    return c.json({ error: 'Too many sign-in attempts. Wait a minute and try again.' }, 429);
  }
  return next();
});

app.post('/auth/start', async (c) => {
  if (authMode(c.env) !== 'email') return c.json({ error: 'This install signs in through Cloudflare Access.' }, 400);
  const body = await c.req.json<{ email?: string; turnstile?: string }>().catch(() => ({}) as { email?: string; turnstile?: string });
  // Bot check before any email is sent.
  if (turnstileSitekey(c.env) && !(await verifyTurnstile(c.env, body.turnstile, 'signin', c.req.header('CF-Connecting-IP')))) {
    return c.json({ error: "We couldn't confirm you're not a bot. Try the check again.", turnstile: true }, 403);
  }
  try {
    return c.json({ ok: true, ...(await startLogin(c.env, body.email ?? '')) });
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

app.post('/auth/verify', async (c) => {
  if (authMode(c.env) !== 'email') return c.json({ error: 'This install signs in through Cloudflare Access.' }, 400);
  const body = await c.req.json<{ email?: string; code?: string }>().catch(() => ({}) as { email?: string; code?: string });
  try {
    const { token, email } = await verifyLogin(c.env, body.email ?? '', body.code ?? '');
    setCookie(c, SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_MAX_AGE });
    return c.json({ ok: true, email });
  } catch (e) {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status);
    throw e;
  }
});

app.post('/auth/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await endSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ---- Directory ----

/** Who am I, and which warehouses can I open? Also signs new users up. */
app.get('/me', async (c) => {
  const mode = (c.env.SIGNUP_MODE as string) === 'open' ? 'open' : 'single';
  const userId = await provision(c.env.DB, c.get('email'), mode);
  return c.json({ ...(await describe(c.env.DB, userId, c.get('email'))), operator: operatorEmails(c.env).includes(c.get('email')) });
});

/** Delete my account. The body must say { "confirm": "DELETE" }. */
app.post('/me/delete', async (c) => {
  const body = await c.req.json<{ confirm?: string }>().catch(() => ({}) as { confirm?: string });
  if (body.confirm !== 'DELETE') return c.json({ error: 'Type DELETE to confirm.' }, 400);
  try {
    const summary = await deleteUser(c.env, c.get('email'));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.json({ ok: true, ...summary });
  } catch (e) {
    if (e instanceof DeleteBlocked) return c.json({ error: e.message }, 409);
    throw e;
  }
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

// ---- Account: members, invites, usage ----

/** The caller's user id and role in :accountId, or a 404 for accounts they aren't in. */
async function membership(c: Context<AppEnv>) {
  const row = await c.env.DB.prepare(
    'SELECT u.id AS user_id, m.role FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = ? AND m.account_id = ?',
  ).bind(c.get('email'), c.req.param('accountId')).first<{ user_id: string; role: Role }>();
  return row;
}

const memberRoute = async (c: Context<AppEnv>, fn: (me: { user_id: string; role: Role }, accountId: string) => Promise<Response>) => {
  const me = await membership(c);
  if (!me) return c.json({ error: 'not found' }, 404);
  try {
    return await fn(me, c.req.param('accountId')!);
  } catch (e) {
    if (e instanceof MemberError) return c.json({ error: e.message }, e.status);
    throw e;
  }
};

app.patch('/accounts/:accountId', (c) =>
  memberRoute(c, async (me, accountId) => {
    if (!canManage(me.role)) return c.json({ error: 'Only owners and admins can rename the account.' }, 403);
    const name = (await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string })).name?.trim().slice(0, 80);
    if (!name) return c.json({ error: 'A name is required.' }, 400);
    await renameAccount(c.env.DB, accountId, name);
    return c.json({ ok: true });
  }),
);

app.get('/accounts/:accountId/members', (c) =>
  memberRoute(c, async (me, accountId) => c.json({ ...(await listMembers(c.env.DB, accountId)), me: me.user_id, role: me.role })),
);

app.post('/accounts/:accountId/invites', (c) =>
  memberRoute(c, async (me, accountId) => {
    if (!canManage(me.role)) return c.json({ error: 'Only owners and admins can invite people.' }, 403);
    const body = await c.req.json<{ email?: string; role?: string }>().catch(() => ({}) as { email?: string; role?: string });
    const email = (body.email ?? '').trim().toLowerCase();
    const role = body.role === 'admin' ? 'admin' : 'member';
    if (!EMAIL_RE.test(email)) return c.json({ error: 'Enter a valid email address.' }, 400);
    await invite(c.env.DB, accountId, email, role, c.get('email'));

    const account = await c.env.DB.prepare('SELECT name FROM accounts WHERE id = ?').bind(accountId).first<{ name: string }>();
    const url = new URL(c.req.url).origin;
    const how = authMode(c.env) === 'email'
      ? `Open ${url} and sign in with ${email}.`
      : `Open ${url} and sign in with ${email}. If you can't get in, ask ${c.get('email')} to add you to the sign-in policy.`;
    let emailed = false;
    if ((c.env as { EXPOSE_LOGIN_CODES?: string }).EXPOSE_LOGIN_CODES !== 'true') {
      try {
        await c.env.EMAIL.send({
          to: email,
          from: { email: c.env.EMAIL_FROM, name: 'NowStocking' },
          subject: `${c.get('email')} invited you to ${account?.name ?? 'a workshop'} on NowStocking`,
          text: `${c.get('email')} invited you to ${account?.name ?? 'their workshop'} on NowStocking, as ${role === 'admin' ? 'an admin' : 'a member'}.\n\n${how}`,
        });
        emailed = true;
      } catch (e) {
        console.error('invite email failed', e);
      }
    }
    return c.json({ ok: true, emailed });
  }),
);

app.delete('/accounts/:accountId/invites/:email', (c) =>
  memberRoute(c, async (me, accountId) => {
    if (!canManage(me.role)) return c.json({ error: 'Only owners and admins can cancel invites.' }, 403);
    await cancelInvite(c.env.DB, accountId, decodeURIComponent(c.req.param('email')!).toLowerCase());
    return c.json({ ok: true });
  }),
);

app.patch('/accounts/:accountId/members/:userId', (c) =>
  memberRoute(c, async (me, accountId) => {
    const role = (await c.req.json<{ role?: string }>().catch(() => ({}) as { role?: string })).role;
    if (role !== 'owner' && role !== 'admin' && role !== 'member') return c.json({ error: 'Unknown role.' }, 400);
    await setRole(c.env.DB, accountId, me.role, c.req.param('userId')!, role);
    return c.json({ ok: true });
  }),
);

app.delete('/accounts/:accountId/members/:userId', (c) =>
  memberRoute(c, async (me, accountId) => {
    await removeMember(c.env.DB, accountId, { userId: me.user_id, role: me.role }, c.req.param('userId')!);
    return c.json({ ok: true });
  }),
);

app.get('/accounts/:accountId/usage', (c) =>
  memberRoute(c, async (_me, accountId) => c.json({ ...(await getUsage(c.env, accountId)), ai: await aiStatus(c.env, accountId) })),
);

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
    const { id: wid, stub, accountId } = c.get('warehouse');
    await assertAiAllowed(c.env, accountId);
    const pages = await stub.startReading(jobId, Array.isArray(body.pages) ? body.pages.map(Number) : undefined);
    try {
      await recordPhotoPages(c.env, accountId, pages.length);
    } catch (e) {
      await stub.cancelReading(jobId, pages);
      throw e;
    }
    try {
      await c.env.IMPORT_WORKFLOW.create({ id: `${jobId}-${Date.now()}`, params: { accountId, warehouseId: wid, jobId, pages } });
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
app.route('/admin', admin);

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
