import { isValidMonth, shiftMonth, type TransactionQuery } from '@homehub/shared';
import { and, asc, count, desc, eq, gte, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Db } from '../../db/client';
import { accounts, categories, transactions, users } from '../../db/schema';

export type TransactionInsert = typeof transactions.$inferInsert;
export type TransactionValues = Omit<
  TransactionInsert,
  'id' | 'workspaceId' | 'createdById' | 'createdAt' | 'updatedAt'
>;

const toAccount = alias(accounts, 'to_account');

/** First day of the month and of the next month as "YYYY-MM-DD" (dates are stored as text). */
export function monthBounds(month: string): { from: string; to: string } {
  if (!isValidMonth(month)) throw new Error(`Invalid month: ${month}`);
  return { from: `${month}-01`, to: `${shiftMonth(month, 1)}-01` };
}

export function buildTransactionFilter(workspaceId: string, query: Partial<TransactionQuery>): SQL {
  const conditions: (SQL | undefined)[] = [eq(transactions.workspaceId, workspaceId)];
  if (query.month) {
    const { from, to } = monthBounds(query.month);
    conditions.push(gte(transactions.occurredAt, from), lt(transactions.occurredAt, to));
  }
  if (query.type) conditions.push(eq(transactions.type, query.type));
  if (query.categoryId) conditions.push(eq(transactions.categoryId, query.categoryId));
  if (query.accountId) {
    conditions.push(
      or(
        eq(transactions.accountId, query.accountId),
        eq(transactions.toAccountId, query.accountId),
      ),
    );
  }
  return and(...conditions) as SQL;
}

const SORT_COLUMNS = {
  occurredAt: transactions.occurredAt,
  amount: transactions.amountMinor,
  createdAt: transactions.createdAt,
} as const;

export class TransactionsRepository {
  constructor(private readonly db: Db) {}

  /** Joined select with every relation the DTO needs; `total` is the window count of matching rows. */
  private selectWithRelations() {
    return this.db
      .select({
        transaction: transactions,
        account: { id: accounts.id, name: accounts.name },
        toAccount: { id: toAccount.id, name: toAccount.name },
        category: {
          id: categories.id,
          name: categories.name,
          color: categories.color,
          systemKey: categories.systemKey,
        },
        createdBy: { id: users.id, name: users.name, email: users.email },
        total: sql<number>`COUNT(*) OVER ()`,
      })
      .from(transactions)
      .innerJoin(accounts, eq(accounts.id, transactions.accountId))
      .leftJoin(toAccount, eq(toAccount.id, transactions.toAccountId))
      .leftJoin(categories, eq(categories.id, transactions.categoryId))
      .innerJoin(users, eq(users.id, transactions.createdById));
  }

  /**
   * The page and the total come from one statement (`COUNT(*) OVER ()`), so they always
   * describe the same snapshot. Joined selects are deliberately not sent through D1 batch():
   * drizzle maps batched rows by column name, which breaks on joins with duplicate names.
   */
  async list(workspaceId: string, query: TransactionQuery) {
    const where = buildTransactionFilter(workspaceId, query);
    const direction = query.sortDir === 'asc' ? asc : desc;
    const rows = await this.selectWithRelations()
      .where(where)
      .orderBy(
        direction(SORT_COLUMNS[query.sortBy]),
        desc(transactions.createdAt),
        asc(transactions.id),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    if (rows[0]) return { total: rows[0].total, rows };
    // A page past the end has no rows to carry the window count.
    const [totalRow] = await this.db.select({ total: count() }).from(transactions).where(where);
    return { total: totalRow?.total ?? 0, rows };
  }

  async findWithRelations(workspaceId: string, id: string) {
    const [row] = await this.selectWithRelations()
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  async findReferences(workspaceId: string, id: string) {
    const [row] = await this.db
      .select({ accountId: transactions.accountId, toAccountId: transactions.toAccountId })
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  /** One row holds both legs of a transfer, so a single INSERT is all-or-nothing. */
  async insert(values: TransactionInsert): Promise<string> {
    const [row] = await this.db
      .insert(transactions)
      .values(values)
      .returning({ id: transactions.id });
    if (!row) throw new Error('Transaction insert returned no row');
    return row.id;
  }

  async update(workspaceId: string, id: string, values: TransactionValues): Promise<boolean> {
    const rows = await this.db
      .update(transactions)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)))
      .returning({ id: transactions.id });
    return rows.length > 0;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.workspaceId, workspaceId)))
      .returning({ id: transactions.id });
    return rows.length > 0;
  }
}

export type TransactionWithRelations = NonNullable<
  Awaited<ReturnType<TransactionsRepository['findWithRelations']>>
>;
