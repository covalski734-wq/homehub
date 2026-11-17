import { shiftMonth, type FinanceSummaryDto } from '@homehub/shared';
import { minorFromSql } from '../../lib/money';
import {
  buildCategorySpending,
  buildDailySeries,
  buildMonthlyTrend,
  summarizeByCurrency,
  type CategoryAmountRow,
  type FlowRow,
} from '../calculations';
import type { SummaryRepository } from '../repositories/summary.repository';
import { balancesByCurrency } from './accounts.service';

const TREND_MONTHS = 6;

export function toCategoryAmounts(
  rows: { categoryId: string | null; currency: string; total: string }[],
): CategoryAmountRow[] {
  return rows
    .filter((row): row is typeof row & { categoryId: string } => row.categoryId !== null)
    .map((row) => ({
      categoryId: row.categoryId,
      currency: row.currency,
      amount: minorFromSql(row.total),
    }));
}

export class SummaryService {
  constructor(private readonly summary: SummaryRepository) {}

  async getMonthSummary(workspaceId: string, month: string): Promise<FinanceSummaryDto> {
    const trendMonths = Array.from({ length: TREND_MONTHS }, (_, i) =>
      shiftMonth(month, i - TREND_MONTHS + 1),
    );
    const snapshot = await this.summary.monthSnapshot(workspaceId, month, trendMonths[0] ?? month);

    const flows: FlowRow[] = snapshot.flows.map((row) => ({
      date: row.date,
      currency: row.currency,
      type: row.type,
      amount: minorFromSql(row.total),
    }));
    const monthFlows = flows.filter((row) => row.date.startsWith(month));
    return {
      month,
      totals: summarizeByCurrency(monthFlows),
      balances: balancesByCurrency(snapshot.accountFlows),
      byCategory: buildCategorySpending(
        toCategoryAmounts(snapshot.spending),
        new Map(snapshot.categories.map((c) => [c.id, c])),
      ),
      daily: buildDailySeries(monthFlows, month),
      trend: buildMonthlyTrend(flows, trendMonths),
    };
  }
}
