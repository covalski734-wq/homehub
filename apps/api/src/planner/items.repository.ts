import { shiftMonth } from '@homehub/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  incomeAmounts,
  incomeDeductions,
  incomeSources,
  recurringAmounts,
  recurringExpenses,
  recurringPayments,
} from '../db/planner-schema';
import { HttpError, notFound } from '../lib/http-error';

/**
 * Income sources and regular expenses share one planning model: a period, an amount history
 * ("effective from month") and one-month overrides/skips. This repository implements the shared
 * part with plain SQL over trusted table names; create/update use Drizzle per table.
 */
const TABLES = {
  income: {
    items: 'income_sources',
    amounts: 'income_amounts',
    overrides: 'income_overrides',
    fk: 'income_id',
  },
  recurring: {
    items: 'recurring_expenses',
    amounts: 'recurring_amounts',
    overrides: 'recurring_overrides',
    fk: 'expense_id',
  },
} as const;
export type ItemKind = keyof typeof TABLES;

export interface ItemHead {
  id: string;
  startMonth: string;
  endMonth: string | null;
  currency: string;
  version: number;
}

export function versionConflict(): HttpError {
  return new HttpError(409, 'PLANNER_VERSION_CONFLICT');
}

export class ItemsRepository {
  constructor(
    private readonly db: Db,
    private readonly d1: D1Database,
  ) {}

  async head(kind: ItemKind, workspaceId: string, id: string): Promise<ItemHead> {
    const t = TABLES[kind];
    const row = await this.d1
      .prepare(
        `SELECT id, start_month AS startMonth, end_month AS endMonth, currency, version
         FROM ${t.items} WHERE id = ?1 AND workspace_id = ?2`,
      )
      .bind(id, workspaceId)
      .first<ItemHead>();
    if (!row)
      throw notFound(
        kind === 'income' ? 'PLANNER_INCOME_NOT_FOUND' : 'PLANNER_RECURRING_NOT_FOUND',
      );
    return row;
  }

  /** MONTH: a one-off amount for that month. FORWARD: a new regular amount from that month on. */
  async setAmount(
    kind: ItemKind,
    workspaceId: string,
    id: string,
    month: string,
    amountMinor: number,
    scope: 'MONTH' | 'FORWARD',
  ) {
    const t = TABLES[kind];
    if (scope === 'MONTH') {
      await this.d1
        .prepare(
          `INSERT INTO ${t.overrides} (workspace_id, ${t.fk}, month, amount_minor, skipped)
           VALUES (?1, ?2, ?3, ?4, 0)
           ON CONFLICT (${t.fk}, month) DO UPDATE SET amount_minor = excluded.amount_minor, skipped = 0`,
        )
        .bind(workspaceId, id, month, amountMinor)
        .run();
      return;
    }
    await this.d1.batch([
      this.d1
        .prepare(
          `INSERT INTO ${t.amounts} (workspace_id, ${t.fk}, effective_month, amount_minor)
           VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (${t.fk}, effective_month) DO UPDATE SET amount_minor = excluded.amount_minor`,
        )
        .bind(workspaceId, id, month, amountMinor),
      // A regular-amount change replaces a one-off amount of that same month (a skip stays).
      this.d1
        .prepare(
          `DELETE FROM ${t.overrides} WHERE ${t.fk} = ?1 AND month = ?2 AND skipped = 0 AND workspace_id = ?3`,
        )
        .bind(id, month, workspaceId),
    ]);
  }

  async setSkipped(
    kind: ItemKind,
    workspaceId: string,
    id: string,
    month: string,
    skipped: boolean,
  ) {
    const t = TABLES[kind];
    if (skipped) {
      await this.d1
        .prepare(
          `INSERT INTO ${t.overrides} (workspace_id, ${t.fk}, month, amount_minor, skipped)
           VALUES (?1, ?2, ?3, NULL, 1)
           ON CONFLICT (${t.fk}, month) DO UPDATE SET skipped = 1`,
        )
        .bind(workspaceId, id, month)
        .run();
      return;
    }
    await this.d1.batch([
      this.d1
        .prepare(
          `DELETE FROM ${t.overrides} WHERE ${t.fk} = ?1 AND month = ?2 AND amount_minor IS NULL AND workspace_id = ?3`,
        )
        .bind(id, month, workspaceId),
      this.d1
        .prepare(
          `UPDATE ${t.overrides} SET skipped = 0 WHERE ${t.fk} = ?1 AND month = ?2 AND workspace_id = ?3`,
        )
        .bind(id, month, workspaceId),
    ]);
  }

  /**
   * Stops an item from `month` on. Earlier months keep it — history is not rewritten.
   * An item that had no month before `month` has no history and is deleted outright.
   */
  async stopFrom(
    kind: ItemKind,
    workspaceId: string,
    item: ItemHead,
    month: string,
  ): Promise<'deleted' | 'ended'> {
    const t = TABLES[kind];
    if (item.startMonth >= month) {
      await this.d1
        .prepare(`DELETE FROM ${t.items} WHERE id = ?1 AND workspace_id = ?2`)
        .bind(item.id, workspaceId)
        .run();
      return 'deleted';
    }
    const end = shiftMonth(month, -1);
    await this.d1.batch([
      this.d1
        .prepare(
          `UPDATE ${t.items} SET end_month = ?1, version = version + 1, updated_at = ?2
           WHERE id = ?3 AND workspace_id = ?4`,
        )
        .bind(end, Date.now(), item.id, workspaceId),
      this.d1
        .prepare(
          `DELETE FROM ${t.amounts} WHERE ${t.fk} = ?1 AND effective_month > ?2 AND workspace_id = ?3`,
        )
        .bind(item.id, end, workspaceId),
      this.d1
        .prepare(
          `DELETE FROM ${t.overrides} WHERE ${t.fk} = ?1 AND month > ?2 AND workspace_id = ?3`,
        )
        .bind(item.id, end, workspaceId),
    ]);
    return 'ended';
  }

  // ---- incomes --------------------------------------------------------------------------

  async createIncome(values: {
    workspaceId: string;
    name: string;
    kind: 'SALARY' | 'BUSINESS' | 'BENEFIT' | 'OTHER';
    currency: string;
    startMonth: string;
    endMonth: string | null;
    amountMinor: number;
    ownerId: string | null;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const { amountMinor, ...source } = values;
    await this.db.batch([
      this.db
        .insert(incomeSources)
        .values({ ...source, id, sortOrder: await this.nextSort('income', values.workspaceId) }),
      this.db.insert(incomeAmounts).values({
        workspaceId: values.workspaceId,
        incomeId: id,
        effectiveMonth: values.startMonth,
        amountMinor,
      }),
    ]);
    return id;
  }

  async updateIncome(
    workspaceId: string,
    id: string,
    version: number,
    changes: Partial<
      Pick<
        typeof incomeSources.$inferInsert,
        'name' | 'kind' | 'currency' | 'startMonth' | 'endMonth' | 'sortOrder' | 'ownerId'
      >
    >,
  ): Promise<void> {
    const rows = await this.db
      .update(incomeSources)
      .set({ ...changes, version: sql`${incomeSources.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(incomeSources.id, id),
          eq(incomeSources.workspaceId, workspaceId),
          eq(incomeSources.version, version),
        ),
      )
      .returning({ id: incomeSources.id });
    if (rows.length === 0) throw await this.missingOrConflict('income', workspaceId, id);
  }

  async createDeduction(values: typeof incomeDeductions.$inferInsert): Promise<string> {
    const id = crypto.randomUUID();
    await this.db.insert(incomeDeductions).values({ ...values, id });
    return id;
  }

  async updateDeduction(
    workspaceId: string,
    id: string,
    version: number,
    changes: Partial<
      Pick<
        typeof incomeDeductions.$inferInsert,
        'name' | 'kind' | 'rateBp' | 'base' | 'amountMinor' | 'currency' | 'startMonth' | 'endMonth'
      >
    >,
  ): Promise<void> {
    const rows = await this.db
      .update(incomeDeductions)
      .set({ ...changes, version: sql`${incomeDeductions.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(incomeDeductions.id, id),
          eq(incomeDeductions.workspaceId, workspaceId),
          eq(incomeDeductions.version, version),
        ),
      )
      .returning({ id: incomeDeductions.id });
    if (rows.length > 0) return;
    const [exists] = await this.db
      .select({ id: incomeDeductions.id })
      .from(incomeDeductions)
      .where(and(eq(incomeDeductions.id, id), eq(incomeDeductions.workspaceId, workspaceId)));
    throw exists ? versionConflict() : notFound('PLANNER_DEDUCTION_NOT_FOUND');
  }

  async deductionIncomeId(workspaceId: string, id: string): Promise<string> {
    const [row] = await this.db
      .select({ incomeId: incomeDeductions.incomeId })
      .from(incomeDeductions)
      .where(and(eq(incomeDeductions.id, id), eq(incomeDeductions.workspaceId, workspaceId)));
    if (!row) throw notFound('PLANNER_DEDUCTION_NOT_FOUND');
    return row.incomeId;
  }

  async deleteDeduction(workspaceId: string, id: string): Promise<void> {
    const rows = await this.db
      .delete(incomeDeductions)
      .where(and(eq(incomeDeductions.id, id), eq(incomeDeductions.workspaceId, workspaceId)))
      .returning({ id: incomeDeductions.id });
    if (rows.length === 0) throw notFound('PLANNER_DEDUCTION_NOT_FOUND');
  }

  // ---- regular expenses -----------------------------------------------------------------

  async setPaid(workspaceId: string, expenseId: string, month: string, paid: boolean) {
    await this.db
      .insert(recurringPayments)
      .values({ workspaceId, expenseId, month, paid })
      .onConflictDoUpdate({
        target: [recurringPayments.expenseId, recurringPayments.month],
        set: { paid, updatedAt: new Date() },
      });
  }

  async createRecurring(values: {
    workspaceId: string;
    name: string;
    isRequired: boolean;
    isOngoing: boolean;
    ongoingStartDay: number | null;
    ongoingEndDay: number | null;
    isLoan: boolean;
    loanTotalMinor: number | null;
    category: string;
    currency: string;
    intervalMonths: number;
    startMonth: string;
    endMonth: string | null;
    dueDay: number | null;
    note: string;
    amountMinor: number;
    ownerId: string | null;
  }): Promise<string> {
    const id = crypto.randomUUID();
    const { amountMinor, ...expense } = values;
    await this.db.batch([
      this.db.insert(recurringExpenses).values({
        ...expense,
        id,
        sortOrder: await this.nextSort('recurring', values.workspaceId),
      }),
      this.db.insert(recurringAmounts).values({
        workspaceId: values.workspaceId,
        expenseId: id,
        effectiveMonth: values.startMonth,
        amountMinor,
      }),
    ]);
    return id;
  }

  async updateRecurring(
    workspaceId: string,
    id: string,
    version: number,
    changes: Partial<
      Pick<
        typeof recurringExpenses.$inferInsert,
        | 'name'
        | 'category'
        | 'isRequired'
        | 'isOngoing'
        | 'ongoingStartDay'
        | 'ongoingEndDay'
        | 'isLoan'
        | 'loanTotalMinor'
        | 'ownerId'
        | 'currency'
        | 'intervalMonths'
        | 'startMonth'
        | 'endMonth'
        | 'dueDay'
        | 'note'
        | 'sortOrder'
      >
    >,
  ): Promise<void> {
    const rows = await this.db
      .update(recurringExpenses)
      .set({ ...changes, version: sql`${recurringExpenses.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(recurringExpenses.id, id),
          eq(recurringExpenses.workspaceId, workspaceId),
          eq(recurringExpenses.version, version),
        ),
      )
      .returning({ id: recurringExpenses.id });
    if (rows.length === 0) throw await this.missingOrConflict('recurring', workspaceId, id);
  }

  private async missingOrConflict(
    kind: ItemKind,
    workspaceId: string,
    id: string,
  ): Promise<HttpError> {
    try {
      await this.head(kind, workspaceId, id);
      return versionConflict();
    } catch (error) {
      if (error instanceof HttpError) return error;
      throw error;
    }
  }

  private async nextSort(kind: ItemKind, workspaceId: string): Promise<number> {
    const row = await this.d1
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM ${TABLES[kind].items} WHERE workspace_id = ?1`,
      )
      .bind(workspaceId)
      .first<{ next: number }>();
    return row?.next ?? 0;
  }
}
