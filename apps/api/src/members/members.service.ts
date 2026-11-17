import {
  MEMBER_COLORS,
  type memberCreateSchema,
  type memberUpdateSchema,
  type MemberDto,
} from '@homehub/shared';
import type { z } from 'zod';
import { notFound, unprocessable } from '../lib/http-error';
import { requireScope, type ServiceContext } from '../lib/service-context';

interface MemberRow {
  id: string;
  name: string;
  color: string;
  user_id: string | null;
  archived_at: number | null;
}

const toDto = (r: MemberRow): MemberDto => ({
  id: r.id,
  name: r.name,
  color: r.color,
  userId: r.user_id,
  archived: r.archived_at !== null,
});

/**
 * Household members: names and colours of whoever owns money. The owner of every money thing
 * (account, fund, plan line) is a member or null (joint); other modules check that through
 * `assertMember` instead of reading the table themselves.
 */
export class MembersService {
  constructor(private readonly d1: D1Database) {}

  /**
   * Every login of the household is a member. Called where a login appears (sign-in) and before
   * writes that need members; reading the list never writes.
   */
  async ensureLogins(workspaceId: string): Promise<void> {
    const missing = await this.d1
      .prepare(
        `SELECT u.id, u.name, u.email FROM workspace_members wm JOIN users u ON u.id = wm.user_id
         WHERE wm.workspace_id = ? AND NOT EXISTS (
           SELECT 1 FROM members m WHERE m.workspace_id = wm.workspace_id AND m.user_id = u.id)`,
      )
      .bind(workspaceId)
      .all<{ id: string; name: string | null; email: string }>();
    if (!missing.results.length) return;
    const count = await this.count(workspaceId);
    const now = Date.now();
    await this.d1.batch(
      missing.results.map((u, i) =>
        this.d1
          .prepare(
            `INSERT INTO members (id, workspace_id, user_id, name, color, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT DO NOTHING`,
          )
          .bind(
            crypto.randomUUID(),
            workspaceId,
            u.id,
            // A person's own name or login, never a translated word.
            (u.name?.trim().split(/\s+/)[0] || u.email.split('@')[0] || u.email).slice(0, 40),
            MEMBER_COLORS[(count + i) % MEMBER_COLORS.length],
            count + i,
            now,
          ),
      ),
    );
  }

  async list(workspaceId: string): Promise<MemberDto[]> {
    const rows = await this.d1
      .prepare(
        `SELECT id, name, color, user_id, archived_at FROM members WHERE workspace_id = ?
         ORDER BY archived_at IS NOT NULL, sort_order, created_at`,
      )
      .bind(workspaceId)
      .all<MemberRow>();
    return rows.results.map(toDto);
  }

  /** An owner must be a member of this household (null — joint). */
  async assertMember(workspaceId: string, memberId: string | null | undefined): Promise<void> {
    if (!memberId) return;
    const row = await this.d1
      .prepare('SELECT 1 FROM members WHERE id = ? AND workspace_id = ?')
      .bind(memberId, workspaceId)
      .first();
    if (!row) throw unprocessable('MEMBER_NOT_FOUND');
  }

  private async count(workspaceId: string): Promise<number> {
    const row = await this.d1
      .prepare('SELECT COUNT(*) AS n FROM members WHERE workspace_id = ?')
      .bind(workspaceId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async create(
    ctx: ServiceContext,
    input: z.output<typeof memberCreateSchema>,
  ): Promise<MemberDto[]> {
    requireScope(ctx, 'household:write');
    await this.d1
      .prepare(
        `INSERT INTO members (id, workspace_id, name, color, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4,
           (SELECT COUNT(*) FROM members WHERE workspace_id = ?2), ?5, ?5)`,
      )
      .bind(crypto.randomUUID(), ctx.workspaceId, input.name, input.color, Date.now())
      .run();
    return this.list(ctx.workspaceId);
  }

  /** Changes only the given fields, so two people editing different fields both keep theirs. */
  async update(
    ctx: ServiceContext,
    id: string,
    input: z.output<typeof memberUpdateSchema>,
  ): Promise<MemberDto[]> {
    requireScope(ctx, 'household:write');
    const now = Date.now();
    const result = await this.d1
      .prepare(
        `UPDATE members SET name = COALESCE(?1, name), color = COALESCE(?2, color),
           archived_at = CASE ?3 WHEN 1 THEN COALESCE(archived_at, ?4) WHEN 0 THEN NULL ELSE archived_at END,
           updated_at = ?4
         WHERE id = ?5 AND workspace_id = ?6`,
      )
      .bind(
        input.name ?? null,
        input.color ?? null,
        input.archived === undefined ? null : input.archived ? 1 : 0,
        now,
        id,
        ctx.workspaceId,
      )
      .run();
    if (!result.meta.changes) throw notFound('MEMBER_NOT_FOUND');
    return this.list(ctx.workspaceId);
  }
}
