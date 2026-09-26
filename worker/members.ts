// Account members and invites.
import type { Role } from '../shared/directory';

const INVITE_DAYS = 30;
const now = () => new Date().toISOString();

export interface Member { user_id: string; email: string; role: Role; created_at: string }
export interface Invite { email: string; role: Role; invited_by: string; created_at: string; expires_at: string }

export class MemberError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

export async function listMembers(db: D1Database, accountId: string) {
  const [members, invites] = await db.batch([
    db.prepare(
      `SELECT m.user_id, u.email, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.account_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email`,
    ).bind(accountId),
    db.prepare('SELECT email, role, invited_by, created_at, expires_at FROM invites WHERE account_id = ? AND expires_at > ? ORDER BY created_at')
      .bind(accountId, now()),
  ]);
  return { members: members.results as unknown as Member[], invites: invites.results as unknown as Invite[] };
}

export async function invite(db: D1Database, accountId: string, email: string, role: 'admin' | 'member', by: string) {
  const already = await db.prepare(
    'SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.account_id = ? AND u.email = ?',
  ).bind(accountId, email).first();
  if (already) throw new MemberError(`${email} is already a member.`, 409);
  const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString();
  await db.prepare(
    `INSERT INTO invites (account_id, email, role, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, email) DO UPDATE SET role = excluded.role, invited_by = excluded.invited_by,
       created_at = excluded.created_at, expires_at = excluded.expires_at`,
  ).bind(accountId, email.toLowerCase(), role, by, now(), expires).run();
}

export async function cancelInvite(db: D1Database, accountId: string, email: string) {
  await db.prepare('DELETE FROM invites WHERE account_id = ? AND email = ?').bind(accountId, email).run();
}

/** Join every account that invited this email. Called at sign-in. */
export async function acceptInvites(db: D1Database, userId: string, email: string): Promise<number> {
  const { results } = await db.prepare('SELECT account_id, role FROM invites WHERE email = ? AND expires_at > ?')
    .bind(email, now()).all<{ account_id: string; role: Role }>();
  if (!results.length) return 0;
  await db.batch([
    ...results.map((r) =>
      db.prepare('INSERT OR IGNORE INTO memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').bind(r.account_id, userId, r.role, now())),
    db.prepare('DELETE FROM invites WHERE email = ?').bind(email),
  ]);
  return results.length;
}

async function owners(db: D1Database, accountId: string) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM memberships WHERE account_id = ? AND role = 'owner'`).bind(accountId).first<{ n: number }>();
  return r?.n ?? 0;
}

async function roleOf(db: D1Database, accountId: string, userId: string) {
  const r = await db.prepare('SELECT role FROM memberships WHERE account_id = ? AND user_id = ?').bind(accountId, userId).first<{ role: Role }>();
  return r?.role ?? null;
}

/** Only owners change roles. The last owner can't step down. */
export async function setRole(db: D1Database, accountId: string, actorRole: Role, userId: string, role: Role) {
  if (actorRole !== 'owner') throw new MemberError('Only an owner can change roles.', 403);
  const current = await roleOf(db, accountId, userId);
  if (!current) throw new MemberError('Not a member.', 404);
  if (current === 'owner' && role !== 'owner' && (await owners(db, accountId)) <= 1) {
    throw new MemberError('Make someone else an owner first.', 409);
  }
  await db.prepare('UPDATE memberships SET role = ? WHERE account_id = ? AND user_id = ?').bind(role, accountId, userId).run();
}

/** Owners remove anyone, admins remove members, anyone can leave. Never the last owner. */
export async function removeMember(db: D1Database, accountId: string, actor: { userId: string; role: Role }, userId: string) {
  const target = await roleOf(db, accountId, userId);
  if (!target) throw new MemberError('Not a member.', 404);
  const self = actor.userId === userId;
  if (!self) {
    if (actor.role === 'member') throw new MemberError("Members can't remove people.", 403);
    if (actor.role === 'admin' && target !== 'member') throw new MemberError('Admins can only remove members.', 403);
  }
  if (target === 'owner' && (await owners(db, accountId)) <= 1) throw new MemberError('An account needs at least one owner.', 409);
  await db.prepare('DELETE FROM memberships WHERE account_id = ? AND user_id = ?').bind(accountId, userId).run();
}

export async function renameAccount(db: D1Database, accountId: string, name: string) {
  await db.prepare('UPDATE accounts SET name = ? WHERE id = ?').bind(name, accountId).run();
}
