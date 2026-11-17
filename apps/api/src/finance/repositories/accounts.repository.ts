import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { accounts, transactions } from '../../db/schema';

export type AccountRow = typeof accounts.$inferSelect;
export type AccountInsert = typeof accounts.$inferInsert;
export type AccountChanges = Partial<
  Pick<
    AccountInsert,
    | 'name'
    | 'type'
    | 'currency'
    | 'initialBalanceMinor'
    | 'archivedAt'
    | 'ownerId'
    | 'color'
    | 'note'
  >
>;

export interface AccountFlowRows {
  accounts: AccountRow[];
  outgoing: {
    accountId: string;
    type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
    total: string;
    count: number;
  }[];
  incoming: { toAccountId: string | null; total: string; count: number }[];
}

export class AccountsRepository {
  constructor(private readonly db: Db) {}

  /** Accounts and their aggregated flows, read in one D1 batch (one consistent snapshot). */
  async loadWithFlows(workspaceId: string, accountId?: string): Promise<AccountFlowRows> {
    const [accountRows, outgoing, incoming] = await this.db.batch(
      this.flowQueries(workspaceId, accountId),
    );
    return { accounts: accountRows, outgoing, incoming };
  }

  /** Query builders for balances; also embedded into the summary batch. */
  flowQueries(workspaceId: string, accountId?: string) {
    const accountFilter = accountId
      ? and(eq(accounts.workspaceId, workspaceId), eq(accounts.id, accountId))
      : eq(accounts.workspaceId, workspaceId);
    return [
      this.db
        .select()
        .from(accounts)
        .where(accountFilter)
        .orderBy(
          sql`${accounts.archivedAt} IS NOT NULL`,
          asc(accounts.archivedAt),
          asc(accounts.createdAt),
        ),
      this.db
        .select({
          accountId: transactions.accountId,
          type: transactions.type,
          total: sql<string>`CAST(SUM(${transactions.amountMinor}) AS TEXT)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(transactions)
        .where(
          accountId
            ? and(eq(transactions.workspaceId, workspaceId), eq(transactions.accountId, accountId))
            : eq(transactions.workspaceId, workspaceId),
        )
        .groupBy(transactions.accountId, transactions.type),
      this.db
        .select({
          toAccountId: transactions.toAccountId,
          total: sql<string>`CAST(SUM(${transactions.toAmountMinor}) AS TEXT)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.workspaceId, workspaceId),
            eq(transactions.type, 'TRANSFER'),
            accountId ? eq(transactions.toAccountId, accountId) : undefined,
          ),
        )
        .groupBy(transactions.toAccountId),
    ] as const;
  }

  async findById(workspaceId: string, id: string): Promise<AccountRow | undefined> {
    const [row] = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }

  async insert(values: AccountInsert): Promise<AccountRow> {
    const [row] = await this.db.insert(accounts).values(values).returning();
    if (!row) throw new Error('Account insert returned no row');
    return row;
  }

  /**
   * Single UPDATE scoped to the workspace. A currency change on an account with operations is
   * rejected inside the same statement by the `accounts_currency_locked` trigger, so no
   * operation can slip in between a check and the update.
   */
  async update(workspaceId: string, id: string, changes: AccountChanges): Promise<boolean> {
    const rows = await this.db
      .update(accounts)
      .set({ ...changes, updatedAt: new Date() })
      .where(and(eq(accounts.id, id), eq(accounts.workspaceId, workspaceId)))
      .returning({ id: accounts.id });
    return rows.length > 0;
  }
}
