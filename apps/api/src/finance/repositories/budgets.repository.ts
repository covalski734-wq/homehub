import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { categories, monthlyBudgets } from '../../db/schema';
import type { SummaryRepository } from './summary.repository';

export class BudgetsRepository {
  constructor(
    private readonly db: Db,
    private readonly summary: SummaryRepository,
  ) {}

  /**
   * Limits and actual spending of the month. The joined select stays outside D1 batch():
   * drizzle maps batched rows by column name, which breaks on joins with duplicate names.
   */
  async listWithSpending(workspaceId: string, month: string) {
    const [budgets, spending] = await Promise.all([
      this.db
        .select({
          budget: monthlyBudgets,
          category: {
            id: categories.id,
            name: categories.name,
            color: categories.color,
            systemKey: categories.systemKey,
          },
        })
        .from(monthlyBudgets)
        .innerJoin(categories, eq(categories.id, monthlyBudgets.categoryId))
        .where(and(eq(monthlyBudgets.workspaceId, workspaceId), eq(monthlyBudgets.month, month)))
        .orderBy(asc(categories.name), asc(monthlyBudgets.currency)),
      this.summary.expenseByCategoryQuery(workspaceId, month),
    ]);
    return { budgets, spending };
  }

  private upsertQuery(values: {
    workspaceId: string;
    categoryId: string;
    month: string;
    currency: string;
    limitMinor: number;
  }) {
    const now = new Date();
    return this.db
      .insert(monthlyBudgets)
      .values({ ...values, id: crypto.randomUUID(), createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: [
          monthlyBudgets.workspaceId,
          monthlyBudgets.categoryId,
          monthlyBudgets.month,
          monthlyBudgets.currency,
        ],
        set: { limitMinor: sql`excluded.limit_minor`, updatedAt: now },
      });
  }

  /** Single INSERT … ON CONFLICT DO UPDATE: create-or-change is one atomic statement. */
  async upsert(values: Parameters<BudgetsRepository['upsertQuery']>[0]): Promise<void> {
    await this.upsertQuery(values);
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(monthlyBudgets)
      .where(and(eq(monthlyBudgets.id, id), eq(monthlyBudgets.workspaceId, workspaceId)))
      .returning({ id: monthlyBudgets.id });
    return rows.length > 0;
  }

  /** All upserts are sent as one D1 batch: either every limit is copied or none is. */
  async copy(workspaceId: string, fromMonth: string, toMonth: string): Promise<number> {
    const source = await this.db
      .select()
      .from(monthlyBudgets)
      .where(and(eq(monthlyBudgets.workspaceId, workspaceId), eq(monthlyBudgets.month, fromMonth)));
    const [first, ...rest] = source.map((budget) =>
      this.upsertQuery({
        workspaceId,
        categoryId: budget.categoryId,
        month: toMonth,
        currency: budget.currency,
        limitMinor: budget.limitMinor,
      }),
    );
    if (first) await this.db.batch([first, ...rest]);
    return source.length;
  }
}
