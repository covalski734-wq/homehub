import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { categories, transactions } from '../../db/schema';
import type { AccountsRepository } from './accounts.repository';
import { monthBounds } from './transactions.repository';

export class SummaryRepository {
  constructor(
    private readonly db: Db,
    private readonly accounts: AccountsRepository,
  ) {}

  /** Income/expense per day, currency and type; transfers are excluded at the query level. */
  dailyFlowsQuery(workspaceId: string, fromMonth: string, toMonth: string) {
    return this.db
      .select({
        date: transactions.occurredAt,
        currency: transactions.currency,
        type: transactions.type,
        total: sql<string>`CAST(SUM(${transactions.amountMinor}) AS TEXT)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          inArray(transactions.type, ['INCOME', 'EXPENSE']),
          gte(transactions.occurredAt, monthBounds(fromMonth).from),
          lt(transactions.occurredAt, monthBounds(toMonth).to),
        ),
      )
      .groupBy(transactions.occurredAt, transactions.currency, transactions.type);
  }

  expenseByCategoryQuery(workspaceId: string, month: string) {
    const { from, to } = monthBounds(month);
    return this.db
      .select({
        categoryId: transactions.categoryId,
        currency: transactions.currency,
        total: sql<string>`CAST(SUM(${transactions.amountMinor}) AS TEXT)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.workspaceId, workspaceId),
          eq(transactions.type, 'EXPENSE'),
          gte(transactions.occurredAt, from),
          lt(transactions.occurredAt, to),
        ),
      )
      .groupBy(transactions.categoryId, transactions.currency);
  }

  /** Every figure of the dashboard comes from one D1 batch — a single consistent snapshot. */
  async monthSnapshot(workspaceId: string, month: string, trendFrom: string) {
    const [accountQuery, outgoingQuery, incomingQuery] = this.accounts.flowQueries(workspaceId);
    const [flows, spending, categoryRows, accountRows, outgoing, incoming] = await this.db.batch([
      this.dailyFlowsQuery(workspaceId, trendFrom, month),
      this.expenseByCategoryQuery(workspaceId, month),
      this.db
        .select({
          id: categories.id,
          name: categories.name,
          color: categories.color,
          systemKey: categories.systemKey,
        })
        .from(categories)
        .where(eq(categories.workspaceId, workspaceId)),
      accountQuery,
      outgoingQuery,
      incomingQuery,
    ]);
    return {
      flows,
      spending,
      categories: categoryRows,
      accountFlows: { accounts: accountRows, outgoing, incoming },
    };
  }
}
