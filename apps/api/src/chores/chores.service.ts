import {
  addDaysToDate,
  CHORE_HISTORY_DAYS,
  chorePoints,
  type ChoreArea,
  type ChoreCompletionDto,
  type ChoreDto,
  type ChoreMemberDto,
  type ChoresOverviewDto,
  type ChoreUpdateInput,
  type choreCompleteSchema,
  type choreCreateSchema,
  type choreSnoozeSchema,
  type choreUpdateSchema,
} from '@homehub/shared';
import type { z } from 'zod';
import { badRequest, conflict, notFound } from '../lib/http-error';

type Out<T extends z.ZodType> = z.output<T>;

interface ChoreRow {
  id: string;
  title: string;
  area: string;
  assignee_id: string | null;
  rotate: number;
  interval_days: number | null;
  due_on: string | null;
  effort: number;
  note: string;
  version: number;
  created_at: number;
  last_done_on: string | null;
  last_done_by: string | null;
  done_count: number;
}

interface CompletionRow {
  id: string;
  chore_id: string;
  user_id: string;
  done_on: string;
  points: number;
  on_time: number;
  prev_due_on: string | null;
  prev_assignee_id: string | null;
  created_at: number;
}

const staleVersion = () => conflict('CHORES_VERSION_CONFLICT');

const CHORE_SELECT = `
  SELECT c.id, c.title, c.area, c.assignee_id, c.rotate, c.interval_days, c.due_on, c.effort,
         c.note, c.version, c.created_at,
         (SELECT done_on FROM chore_completions x WHERE x.chore_id = c.id
            ORDER BY done_on DESC, created_at DESC LIMIT 1) AS last_done_on,
         (SELECT user_id FROM chore_completions x WHERE x.chore_id = c.id
            ORDER BY done_on DESC, created_at DESC LIMIT 1) AS last_done_by,
         (SELECT count(*) FROM chore_completions x WHERE x.chore_id = c.id) AS done_count
  FROM chores c`;

function toChore(row: ChoreRow): ChoreDto {
  return {
    id: row.id,
    title: row.title,
    area: row.area as ChoreArea,
    assigneeId: row.assignee_id,
    rotate: Boolean(row.rotate),
    intervalDays: row.interval_days,
    dueOn: row.due_on,
    effort: row.effort,
    note: row.note,
    version: row.version,
    lastDoneOn: row.last_done_on,
    lastDoneBy: row.last_done_by,
    doneCount: row.done_count,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function toCompletion(row: CompletionRow): ChoreCompletionDto {
  return {
    id: row.id,
    choreId: row.chore_id,
    userId: row.user_id,
    doneOn: row.done_on,
    points: row.points,
    onTime: Boolean(row.on_time),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

/** The member after `current` in join order (wraps around); the first one when unknown. */
export function nextAssignee(members: string[], current: string | null): string | null {
  if (members.length === 0) return null;
  const index = current ? members.indexOf(current) : -1;
  return members[(index + 1) % members.length] ?? null;
}

/**
 * Household chores on D1. Every change is guarded by the row version, so two members editing or
 * ticking off the same chore at once cannot both apply: the second gets a conflict and fresh data.
 */
export class ChoresService {
  constructor(private readonly db: D1Database) {}

  async members(workspaceId: string): Promise<ChoreMemberDto[]> {
    const { results } = await this.db
      .prepare(
        `SELECT u.id, u.name, u.email, u.avatar_url FROM workspace_members m
         JOIN users u ON u.id = m.user_id WHERE m.workspace_id = ?
         ORDER BY m.created_at, u.email`,
      )
      .bind(workspaceId)
      .all<{ id: string; name: string | null; email: string; avatar_url: string | null }>();
    return results.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      avatarUrl: r.avatar_url,
    }));
  }

  async overview(workspaceId: string, today: string): Promise<ChoresOverviewDto> {
    const since = addDaysToDate(today, -CHORE_HISTORY_DAYS);
    const [chores, completions, members] = await Promise.all([
      this.db
        .prepare(
          `${CHORE_SELECT} WHERE c.workspace_id = ? ORDER BY c.due_on IS NULL, c.due_on, c.title`,
        )
        .bind(workspaceId)
        .all<ChoreRow>(),
      this.db
        .prepare(
          `SELECT id, chore_id, user_id, done_on, points, on_time, prev_due_on, prev_assignee_id,
                  created_at
           FROM chore_completions WHERE workspace_id = ? AND done_on >= ?
           ORDER BY done_on DESC, created_at DESC LIMIT 1000`,
        )
        .bind(workspaceId, since)
        .all<CompletionRow>(),
      this.members(workspaceId),
    ]);
    return {
      chores: chores.results.map(toChore),
      members,
      completions: completions.results.map(toCompletion),
    };
  }

  private async chore(workspaceId: string, id: string): Promise<ChoreDto> {
    const row = await this.db
      .prepare(`${CHORE_SELECT} WHERE c.workspace_id = ? AND c.id = ?`)
      .bind(workspaceId, id)
      .first<ChoreRow>();
    if (!row) throw notFound('CHORES_CHORE_NOT_FOUND');
    return toChore(row);
  }

  private async assertMember(workspaceId: string, userId: string | null | undefined) {
    if (!userId) return;
    const found = await this.db
      .prepare('SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind(workspaceId, userId)
      .first();
    if (!found) throw badRequest('CHORES_ASSIGNEE_NOT_MEMBER');
  }

  async create(
    workspaceId: string,
    userId: string,
    input: Out<typeof choreCreateSchema>,
  ): Promise<ChoreDto> {
    await this.assertMember(workspaceId, input.assigneeId);
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO chores (id, workspace_id, title, area, assignee_id, rotate, interval_days,
           due_on, effort, note, version, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(
        id,
        workspaceId,
        input.title,
        input.area,
        input.assigneeId,
        input.rotate ? 1 : 0,
        input.intervalDays,
        input.dueOn,
        input.effort,
        input.note,
        userId,
        now,
        now,
      )
      .run();
    return this.chore(workspaceId, id);
  }

  async update(
    workspaceId: string,
    id: string,
    input: Out<typeof choreUpdateSchema>,
  ): Promise<ChoreDto> {
    const { version, ...changes } = input;
    if ('assigneeId' in changes) await this.assertMember(workspaceId, changes.assigneeId);
    const columns: Record<keyof Omit<ChoreUpdateInput, 'version'>, string> = {
      title: 'title',
      area: 'area',
      assigneeId: 'assignee_id',
      rotate: 'rotate',
      intervalDays: 'interval_days',
      dueOn: 'due_on',
      effort: 'effort',
      note: 'note',
    };
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of Object.entries(columns) as [keyof typeof columns, string][]) {
      if (!(key in changes)) continue;
      const value = changes[key];
      sets.push(`${column} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : (value ?? null));
    }
    await this.guarded(
      workspaceId,
      id,
      `UPDATE chores SET ${[...sets, 'version = version + 1', 'updated_at = ?'].join(', ')}
       WHERE workspace_id = ? AND id = ? AND version = ?`,
      [...values, Date.now(), workspaceId, id, version],
    );
    return this.chore(workspaceId, id);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const result = await this.db
      .prepare('DELETE FROM chores WHERE workspace_id = ? AND id = ?')
      .bind(workspaceId, id)
      .run();
    if (!result.meta.changes) throw notFound('CHORES_CHORE_NOT_FOUND');
  }

  async complete(
    workspaceId: string,
    userId: string,
    id: string,
    input: Out<typeof choreCompleteSchema>,
  ): Promise<{ chore: ChoreDto; completion: ChoreCompletionDto }> {
    const chore = await this.chore(workspaceId, id);
    if (chore.version !== input.version) throw staleVersion();
    if (chore.dueOn === null) throw conflict('CHORES_ALREADY_DONE');
    const members = chore.rotate ? (await this.members(workspaceId)).map((m) => m.id) : [];
    const nextDue =
      chore.intervalDays === null ? null : addDaysToDate(input.doneOn, chore.intervalDays);
    const assignee = chore.rotate ? nextAssignee(members, userId) : chore.assigneeId;
    const onTime = input.doneOn <= chore.dueOn;
    const points = chorePoints(chore.effort, chore.dueOn, input.doneOn);
    const completionId = crypto.randomUUID();
    const now = Date.now();
    // The completion is recorded only if the guarded update applied (same batch, same version).
    const [update] = await this.db.batch([
      this.db
        .prepare(
          `UPDATE chores SET due_on = ?, assignee_id = ?, version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ? AND version = ?`,
        )
        .bind(nextDue, assignee, now, workspaceId, id, input.version),
      this.db
        .prepare(
          `INSERT INTO chore_completions (id, workspace_id, chore_id, user_id, done_on, points,
             on_time, prev_due_on, prev_assignee_id, created_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           WHERE (SELECT version FROM chores WHERE id = ? AND workspace_id = ?) = ?`,
        )
        .bind(
          completionId,
          workspaceId,
          id,
          userId,
          input.doneOn,
          points,
          onTime ? 1 : 0,
          chore.dueOn,
          chore.assigneeId,
          now,
          id,
          workspaceId,
          input.version + 1,
        ),
    ]);
    if (!update?.meta.changes) throw staleVersion();
    return {
      chore: await this.chore(workspaceId, id),
      completion: {
        id: completionId,
        choreId: id,
        userId,
        doneOn: input.doneOn,
        points,
        onTime,
        createdAt: new Date(now).toISOString(),
      },
    };
  }

  async snooze(
    workspaceId: string,
    id: string,
    input: Out<typeof choreSnoozeSchema>,
    today: string,
  ): Promise<ChoreDto> {
    const chore = await this.chore(workspaceId, id);
    if (chore.dueOn === null) throw conflict('CHORES_ALREADY_DONE');
    // Snoozing an overdue chore counts from today, not from the missed date.
    const from = chore.dueOn < today ? today : chore.dueOn;
    await this.guarded(
      workspaceId,
      id,
      `UPDATE chores SET due_on = ?, version = version + 1, updated_at = ?
       WHERE workspace_id = ? AND id = ? AND version = ?`,
      [addDaysToDate(from, input.days), Date.now(), workspaceId, id, input.version],
    );
    return this.chore(workspaceId, id);
  }

  /**
   * Removes a completion. Undoing the chore's latest completion also restores its due date and
   * assignee; an older one only disappears from the history and the points.
   */
  async undo(workspaceId: string, completionId: string): Promise<ChoreDto> {
    const completion = await this.db
      .prepare(
        `SELECT id, chore_id, user_id, done_on, points, on_time, prev_due_on, prev_assignee_id,
                created_at
         FROM chore_completions WHERE workspace_id = ? AND id = ?`,
      )
      .bind(workspaceId, completionId)
      .first<CompletionRow>();
    if (!completion) throw notFound('CHORES_COMPLETION_NOT_FOUND');
    // One batch: the chore goes back to its state before this completion only if the completion
    // still exists and is still the latest (a completion added meanwhile keeps its effect).
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE chores SET due_on = ?1, assignee_id = ?2, version = version + 1, updated_at = ?3
           WHERE workspace_id = ?4 AND id = ?5
             AND EXISTS (SELECT 1 FROM chore_completions WHERE id = ?6 AND workspace_id = ?4)
             AND NOT EXISTS (SELECT 1 FROM chore_completions c WHERE c.chore_id = ?5
               AND c.workspace_id = ?4 AND c.id <> ?6
               AND (c.done_on > ?7 OR (c.done_on = ?7 AND c.created_at > ?8)))`,
        )
        .bind(
          completion.prev_due_on,
          completion.prev_assignee_id,
          Date.now(),
          workspaceId,
          completion.chore_id,
          completionId,
          completion.done_on,
          completion.created_at,
        ),
      this.db
        .prepare('DELETE FROM chore_completions WHERE workspace_id = ? AND id = ?')
        .bind(workspaceId, completionId),
    ]);
    return this.chore(workspaceId, completion.chore_id);
  }

  private async guarded(workspaceId: string, id: string, statement: string, values: unknown[]) {
    const result = await this.db
      .prepare(statement)
      .bind(...values)
      .run();
    if (result.meta.changes) return;
    await this.chore(workspaceId, id); // 404 when it no longer exists
    throw staleVersion();
  }
}
