import type { BudgetCopyPayload, BudgetDto, BudgetUpsertPayload } from '@homehub/shared';
import { notFound, unprocessable } from '../../lib/http-error';
import { formatMinor, toMinorNumber } from '../../lib/money';
import { budgetProgress } from '../calculations';
import type { BudgetsRepository } from '../repositories/budgets.repository';
import type { CategoriesRepository } from '../repositories/categories.repository';
import { toCategoryAmounts } from './summary.service';

export class BudgetsService {
  constructor(
    private readonly budgets: BudgetsRepository,
    private readonly categories: CategoriesRepository,
  ) {}

  async list(workspaceId: string, month: string): Promise<BudgetDto[]> {
    const { budgets, spending } = await this.budgets.listWithSpending(workspaceId, month);
    const spent = new Map(
      toCategoryAmounts(spending).map((row) => [`${row.categoryId}|${row.currency}`, row.amount]),
    );
    return budgets.map(({ budget, category }) => {
      const limit = BigInt(budget.limitMinor);
      const used = spent.get(`${budget.categoryId}|${budget.currency}`) ?? 0n;
      return {
        id: budget.id,
        month: budget.month,
        currency: budget.currency,
        limit: formatMinor(limit),
        spent: formatMinor(used),
        ...budgetProgress(limit, used),
        category,
      };
    });
  }

  async upsert(workspaceId: string, payload: BudgetUpsertPayload): Promise<BudgetDto> {
    const category = await this.categories.findById(workspaceId, payload.categoryId);
    if (!category) throw unprocessable('FINANCE_CATEGORY_NOT_FOUND');
    if (category.kind !== 'EXPENSE') {
      throw unprocessable('FINANCE_BUDGET_EXPENSE_ONLY');
    }

    await this.budgets.upsert({
      workspaceId,
      categoryId: payload.categoryId,
      month: payload.month,
      currency: payload.currency,
      limitMinor: toMinorNumber(payload.limit),
    });
    const result = (await this.list(workspaceId, payload.month)).find(
      (b) => b.category.id === payload.categoryId && b.currency === payload.currency,
    );
    if (!result) throw notFound('FINANCE_BUDGET_NOT_FOUND');
    return result;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const deleted = await this.budgets.delete(workspaceId, id);
    if (!deleted) throw notFound('FINANCE_BUDGET_NOT_FOUND');
  }

  /** Copies all limits of one month into another atomically; existing target limits are overwritten. */
  async copy(
    workspaceId: string,
    { fromMonth, toMonth }: BudgetCopyPayload,
  ): Promise<{ copied: number }> {
    return { copied: await this.budgets.copy(workspaceId, fromMonth, toMonth) };
  }
}
