// D1 directory: users, accounts, memberships, warehouses.
import type { AccountInfo, MeResponse, Role } from '../shared/directory';

const now = () => new Date().toISOString();

/** 10 characters from a-z0-9: short enough for a label URL, ~51 bits of randomness. */
export function newWarehouseId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % 36]).join('');
}

async function upsertUser(db: D1Database, email: string): Promise<string> {
  const row = await db
    .prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET email = email RETURNING id')
    .bind(crypto.randomUUID(), email.toLowerCase(), now())
    .first<{ id: string }>();
  return row!.id;
}

async function createAccount(db: D1Database, userId: string, name: string, role: Role = 'owner') {
  const accountId = crypto.randomUUID();
  const t = now();
  await db.batch([
    db.prepare('INSERT INTO accounts (id, name, created_at) VALUES (?, ?, ?)').bind(accountId, name, t),
    db.prepare('INSERT INTO memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').bind(accountId, userId, role, t),
    db.prepare('INSERT INTO warehouses (id, account_id, name, created_at) VALUES (?, ?, ?, ?)').bind(newWarehouseId(), accountId, 'Main', t),
  ]);
}

/**
 * Make sure the user exists and belongs somewhere.
 * - single (self-hosted): everyone who gets past sign-in joins the one account. The first person is its owner.
 * - open (hosted): a new user gets their own account and first warehouse.
 */
export async function provision(db: D1Database, email: string, mode: 'single' | 'open'): Promise<string> {
  const userId = await upsertUser(db, email);
  const has = await db.prepare('SELECT 1 FROM memberships WHERE user_id = ? LIMIT 1').bind(userId).first();
  if (has) return userId;

  if (mode === 'single') {
    const account = await db.prepare('SELECT id FROM accounts ORDER BY created_at LIMIT 1').first<{ id: string }>();
    if (account) {
      await db.prepare('INSERT OR IGNORE INTO memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)')
        .bind(account.id, userId, 'member', now()).run();
      return userId;
    }
    await createAccount(db, userId, 'Workshop');
    return userId;
  }
  await createAccount(db, userId, `${email.split('@')[0]}'s workshop`);
  return userId;
}

export async function describe(db: D1Database, userId: string, email: string): Promise<MeResponse> {
  const { results } = await db.prepare(
    `SELECT a.id AS account_id, a.name AS account_name, m.role, w.id AS warehouse_id, w.name AS warehouse_name
     FROM memberships m
     JOIN accounts a ON a.id = m.account_id
     LEFT JOIN warehouses w ON w.account_id = a.id AND w.archived_at IS NULL
     WHERE m.user_id = ?
     ORDER BY a.created_at, w.created_at`,
  ).bind(userId).all<{ account_id: string; account_name: string; role: Role; warehouse_id: string | null; warehouse_name: string | null }>();
  const accounts = new Map<string, AccountInfo>();
  for (const r of results) {
    let a = accounts.get(r.account_id);
    if (!a) accounts.set(r.account_id, (a = { id: r.account_id, name: r.account_name, role: r.role, warehouses: [] }));
    if (r.warehouse_id) a.warehouses.push({ id: r.warehouse_id, name: r.warehouse_name! });
  }
  return { user: { id: userId, email }, accounts: [...accounts.values()] };
}

/** The caller's role in the account that owns this warehouse, or null if they can't open it. */
export async function warehouseRole(db: D1Database, email: string, warehouseId: string) {
  return db.prepare(
    `SELECT m.role, w.account_id FROM warehouses w
     JOIN memberships m ON m.account_id = w.account_id
     JOIN users u ON u.id = m.user_id
     WHERE w.id = ? AND u.email = ? AND w.archived_at IS NULL`,
  ).bind(warehouseId, email.toLowerCase()).first<{ role: Role; account_id: string }>();
}

export async function accountRole(db: D1Database, email: string, accountId: string) {
  const row = await db.prepare(
    'SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = ? AND u.email = ?',
  ).bind(accountId, email.toLowerCase()).first<{ role: Role }>();
  return row?.role ?? null;
}

export async function createWarehouse(db: D1Database, accountId: string, name: string): Promise<string> {
  const id = newWarehouseId();
  await db.prepare('INSERT INTO warehouses (id, account_id, name, created_at) VALUES (?, ?, ?, ?)').bind(id, accountId, name, now()).run();
  return id;
}

export async function renameWarehouse(db: D1Database, id: string, name: string) {
  await db.prepare('UPDATE warehouses SET name = ? WHERE id = ?').bind(name, id).run();
}

/** Archive a warehouse. Its data stays in its Durable Object; it just stops being listed or reachable. */
export async function archiveWarehouse(db: D1Database, id: string, accountId: string): Promise<boolean> {
  const left = await db.prepare('SELECT COUNT(*) AS n FROM warehouses WHERE account_id = ? AND archived_at IS NULL').bind(accountId).first<{ n: number }>();
  if ((left?.n ?? 0) <= 1) return false;
  await db.prepare('UPDATE warehouses SET archived_at = ? WHERE id = ?').bind(now(), id).run();
  return true;
}
