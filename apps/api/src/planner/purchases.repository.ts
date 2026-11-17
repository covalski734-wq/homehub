import type { PurchaseEventType, PurchaseStatus } from '@homehub/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { purchaseEvents, purchases } from '../db/planner-schema';
import { users } from '../db/schema';
import { notFound } from '../lib/http-error';
import { guard, guardedBatch } from '../lib/batch-guard';
import { versionConflict } from './items.repository';
import type { PurchaseRow } from './planner.repository';

export type PurchaseChanges = Partial<
  Pick<
    typeof purchases.$inferInsert,
    | 'title'
    | 'category'
    | 'priority'
    | 'currency'
    | 'estimatedAmountMinor'
    | 'plannedMonth'
    | 'note'
  >
>;

/** API field → column for the guarded UPDATE (values are always bound, never interpolated). */
const COLUMNS = {
  title: 'title',
  category: 'category',
  priority: 'priority',
  currency: 'currency',
  estimatedAmountMinor: 'estimated_amount_minor',
  plannedMonth: 'planned_month',
  note: 'note',
  status: 'status',
  purchasedOn: 'purchased_on',
  actualAmountMinor: 'actual_amount_minor',
} as const;

export interface EventInput {
  type: PurchaseEventType;
  toMonth?: string | null;
  amountMinor?: number | null;
  eventDate?: string | null;
}

/**
 * Every state change is one D1 batch: first the history event is inserted *if* the row still
 * has the expected version (capturing the old planned month as `from_month`), then the row is
 * updated under the same condition. Either both happen or neither — and a concurrent editor with
 * a stale version changes nothing and gets 409.
 */
export class PurchasesRepository {
  constructor(
    private readonly db: Db,
    private readonly d1: D1Database,
  ) {}

  list(workspaceId: string, filter: { status?: PurchaseStatus; month?: string }) {
    const conditions = [eq(purchases.workspaceId, workspaceId)];
    if (filter.status) conditions.push(eq(purchases.status, filter.status));
    if (filter.month) conditions.push(eq(purchases.plannedMonth, filter.month));
    return this.db
      .select()
      .from(purchases)
      .where(and(...conditions))
      .orderBy(
        sql`CASE ${purchases.status} WHEN 'ACTIVE' THEN 0 WHEN 'PURCHASED' THEN 1 ELSE 2 END`,
        sql`${purchases.plannedMonth} IS NULL`,
        asc(purchases.plannedMonth),
        sql`CASE ${purchases.priority} WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END`,
        asc(purchases.createdAt),
      );
  }

  async find(workspaceId: string, id: string): Promise<PurchaseRow> {
    const [row] = await this.db
      .select()
      .from(purchases)
      .where(and(eq(purchases.id, id), eq(purchases.workspaceId, workspaceId)));
    if (!row) throw notFound('PLANNER_PURCHASE_NOT_FOUND');
    return row;
  }

  async create(
    values: typeof purchases.$inferInsert & { workspaceId: string },
    userId: string,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();
    await this.db.batch([
      this.db
        .insert(purchases)
        .values({ ...values, id, status: 'ACTIVE', createdAt: now, updatedAt: now }),
      this.db.insert(purchaseEvents).values({
        workspaceId: values.workspaceId,
        purchaseId: id,
        type: 'CREATED',
        toMonth: values.plannedMonth ?? null,
        amountMinor: values.estimatedAmountMinor,
        currency: values.currency,
        createdById: userId,
        createdAt: now,
      }),
    ]);
    return id;
  }

  /** Applies `changes` and appends `event` atomically, guarded by the expected version. */
  async change(
    workspaceId: string,
    id: string,
    version: number,
    changes: PurchaseChanges & {
      status?: PurchaseStatus;
      purchasedOn?: string | null;
      actualAmountMinor?: number | null;
    },
    event: EventInput,
    userId: string,
    allowedStatuses: PurchaseStatus[],
    /** Statements of other modules (the purchase's operation) written only if the change is. */
    extra: D1PreparedStatement[] = [],
  ): Promise<void> {
    const now = Date.now();
    const statusList = allowedStatuses.map((s) => `'${s}'`).join(', ');
    const where = `id = ?1 AND workspace_id = ?2 AND version = ?3 AND status IN (${statusList})`;
    const guard_ = `id = ? AND workspace_id = ? AND version = ? AND status IN (${statusList})`;
    const insertEvent = this.d1
      .prepare(
        `INSERT INTO purchase_events
           (id, workspace_id, purchase_id, type, from_month, to_month, amount_minor, currency, event_date, created_by_id, created_at)
         SELECT ?4, workspace_id, id, ?5, planned_month, CASE WHEN ?12 = 1 THEN ?6 ELSE planned_month END,
                ?7, COALESCE(?8, currency), ?9, ?10, ?11
         FROM purchases WHERE ${where}`,
      )
      .bind(
        id,
        workspaceId,
        version,
        crypto.randomUUID(),
        event.type,
        event.toMonth === undefined ? null : event.toMonth,
        event.amountMinor ?? null,
        changes.currency ?? null,
        event.eventDate ?? null,
        userId,
        now,
        // to_month: the explicit new month, or the unchanged planned month.
        event.toMonth === undefined ? 0 : 1,
      );
    const assignments = Object.entries(changes)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => {
        const column = COLUMNS[field as keyof typeof COLUMNS];
        if (!column) throw new Error(`Unknown purchase field: ${field}`);
        return { column, value: value as string | number | null };
      });
    const setClause = [
      ...assignments.map((a, i) => `${a.column} = ?${i + 5}`),
      `version = version + 1`,
      `updated_at = ?4`,
    ].join(', ');
    const update = this.d1
      .prepare(`UPDATE purchases SET ${setClause} WHERE ${where} RETURNING id`)
      .bind(id, workspaceId, version, now, ...assignments.map((a) => a.value));

    if (extra.length) {
      // One transaction: the version is checked before the operation is written.
      await guardedBatch(
        this.d1,
        [
          guard(
            this.d1,
            `EXISTS (SELECT 1 FROM purchases WHERE ${guard_})`,
            id,
            workspaceId,
            version,
          ),
          ...extra,
          insertEvent,
          update,
        ],
        async () => {
          await this.staleOrMissing(workspaceId, id);
          return versionConflict();
        },
      );
      return;
    }
    const [, updated] = await this.d1.batch([insertEvent, update]);
    if (!updated?.results.length) await this.staleOrMissing(workspaceId, id);
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(purchases)
      .where(and(eq(purchases.id, id), eq(purchases.workspaceId, workspaceId)))
      .returning({ id: purchases.id });
    return rows.length > 0;
  }

  history(workspaceId: string, id: string) {
    return this.db
      .select({ event: purchaseEvents, userName: users.name, userEmail: users.email })
      .from(purchaseEvents)
      .leftJoin(users, eq(users.id, purchaseEvents.createdById))
      .where(and(eq(purchaseEvents.purchaseId, id), eq(purchaseEvents.workspaceId, workspaceId)))
      .orderBy(desc(purchaseEvents.createdAt), desc(purchaseEvents.id));
  }

  async staleOrMissing(workspaceId: string, id: string): Promise<never> {
    await this.find(workspaceId, id);
    throw versionConflict();
  }
}
