import { SYSTEM_CATEGORIES } from '@homehub/shared';
import { and, eq, lte, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { sessions, users, workspaces, workspaceMembers } from '../db/schema';

/** Slug of the single shared household workspace (MVP: one workspace for everyone on the allowlist). */
export const HOME_WORKSPACE_SLUG = 'home';

export interface NewSession {
  id: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface LoginIdentity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

const firstWorkspaceId = sql<string | null>`(
  SELECT ${workspaceMembers.workspaceId} FROM ${workspaceMembers}
  WHERE ${workspaceMembers.userId} = ${sessions.userId}
    AND ${workspaceMembers.workspaceId} IN (SELECT ${workspaces.id} FROM ${workspaces} WHERE ${workspaces.slug} NOT LIKE 'demo:%')
  ORDER BY ${workspaceMembers.createdAt} LIMIT 1
)`;

export class AuthRepository {
  constructor(
    private readonly db: Db,
    private readonly d1: D1Database,
  ) {}

  async findSessionByTokenHash(tokenHash: string) {
    const [row] = await this.db
      .select({
        id: sessions.id,
        userId: sessions.userId,
        csrfToken: sessions.csrfToken,
        expiresAt: sessions.expiresAt,
        email: users.email,
        workspaceId: firstWorkspaceId,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash))
      .limit(1);
    return row;
  }

  async renewSession(sessionId: string, expiresAt: Date, now: Date): Promise<void> {
    await this.db
      .update(sessions)
      .set({ expiresAt, lastUsedAt: now })
      .where(eq(sessions.id, sessionId));
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  async deleteSessionByTokenHash(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async getProfile(sessionId: string) {
    const [row] = await this.db
      .select({
        csrfToken: sessions.csrfToken,
        expiresAt: sessions.expiresAt,
        user: { id: users.id, email: users.email, name: users.name, avatarUrl: users.avatarUrl },
        workspace: { id: workspaces.id, name: workspaces.name },
        role: workspaceMembers.role,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .innerJoin(workspaces, eq(workspaces.id, firstWorkspaceId))
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, users.id)),
      )
      .where(eq(sessions.id, sessionId))
      .limit(1);
    return row;
  }

  async findUserSubByEmail(email: string): Promise<string | undefined> {
    const [row] = await this.db
      .select({ loginId: users.loginId })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return row?.loginId;
  }

  async deleteExpired(now: Date): Promise<{ sessions: number; flows: number }> {
    const rows = await this.db
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .returning({ id: sessions.id });
    await this.d1
      .prepare('DELETE FROM login_attempts WHERE expires_at < ?')
      .bind(now.getTime())
      .run();
    return { sessions: rows.length, flows: 0 };
  }

  /**
   * The whole login is one D1 batch, i.e. one SQL transaction: the shared workspace, the user,
   * the membership, system categories and the new session are created together or not at all.
   *
   * Concurrency: the workspace row is keyed by a unique slug and inserted with ON CONFLICT DO
   * NOTHING, so two people logging in for the first time at the same moment converge on the
   * same workspace (this replaces PostgreSQL's advisory lock). Every step is idempotent, so a
   * repeated login changes nothing but the profile, last login time and the session.
   */
  async completeLogin(input: {
    identity: LoginIdentity;
    workspaceName: string;
    session: NewSession;
    previousTokenHash: string | null;
    now: Date;
  }): Promise<void> {
    const { identity, session, now } = input;
    const nowMs = now.getTime();
    const statements: D1PreparedStatement[] = [
      this.d1
        .prepare(
          `INSERT INTO workspaces (id, slug, name, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?4)
           ON CONFLICT (slug) DO NOTHING`,
        )
        .bind(crypto.randomUUID(), HOME_WORKSPACE_SLUG, input.workspaceName, nowMs),
      this.d1
        .prepare(
          `INSERT INTO users (id, login_id, email, name, avatar_url, last_login_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?6)
           ON CONFLICT (login_id) DO UPDATE SET
             email = excluded.email,
             name = excluded.name,
             avatar_url = excluded.avatar_url,
             last_login_at = excluded.last_login_at,
             updated_at = excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          identity.sub,
          identity.email,
          identity.name,
          identity.picture,
          nowMs,
        ),
      // A user joins the shared workspace once; the first member becomes its owner.
      this.d1
        .prepare(
          `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
           SELECT w.id, u.id,
             CASE WHEN EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id)
               THEN 'MEMBER' ELSE 'OWNER' END,
             ?3
           FROM workspaces w JOIN users u ON u.login_id = ?2
           WHERE w.slug = ?1
             AND NOT EXISTS (SELECT 1 FROM workspace_members x JOIN workspaces normal ON normal.id = x.workspace_id WHERE x.user_id = u.id AND normal.slug NOT LIKE 'demo:%')
           ON CONFLICT DO NOTHING`,
        )
        .bind(HOME_WORKSPACE_SLUG, identity.sub, nowMs),
      this.systemCategoriesStatement(nowMs),
    ];
    if (input.previousTokenHash) {
      // Session fixation protection: a previous session cookie never survives a new login.
      statements.push(
        this.d1.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(input.previousTokenHash),
      );
    }
    statements.push(
      this.d1
        .prepare(
          `INSERT INTO sessions (id, token_hash, csrf_token, user_id, expires_at, last_used_at, user_agent, ip_address, created_at)
           SELECT ?1, ?2, ?3, u.id, ?4, ?5, ?6, ?7, ?5
           FROM users u WHERE u.login_id = ?8`,
        )
        .bind(
          session.id,
          session.tokenHash,
          session.csrfToken,
          session.expiresAt.getTime(),
          nowMs,
          session.userAgent,
          session.ipAddress,
          identity.sub,
        ),
    );

    const results = await this.d1.batch(statements);
    if (results.at(-1)?.meta.changes !== 1) throw new Error('Session was not created');
  }

  /** Adds missing system categories to the shared workspace (idempotent, one statement). */
  private systemCategoriesStatement(nowMs: number): D1PreparedStatement {
    const values = SYSTEM_CATEGORIES.map(() => '(?, ?, ?, ?, ?)').join(', ');
    const params = SYSTEM_CATEGORIES.flatMap((c) => [
      crypto.randomUUID(),
      c.key,
      c.name,
      c.kind,
      c.color,
    ]);
    return this.d1
      .prepare(
        `INSERT INTO categories (id, workspace_id, system_key, name, kind, color, is_system, created_at, updated_at)
         SELECT v.column1, w.id, v.column2, v.column3, v.column4, v.column5, 1, ?, ?
         FROM (VALUES ${values}) AS v
         JOIN workspaces w ON w.slug = ?
         WHERE true
         ON CONFLICT DO NOTHING`,
      )
      .bind(nowMs, nowMs, ...params, HOME_WORKSPACE_SLUG);
  }
}
