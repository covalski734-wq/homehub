import type { QueryClient } from '@tanstack/react-query';
import type { TransactionQueryInput } from '@homehub/shared';

/**
 * Every cache key starts with one of these roots. Feature key factories (plannerKeys,
 * savingsKeys, crmKeys, …) build on them, so renaming a root breaks the compile instead of an
 * invalidation quietly missing its queries.
 */
export const roots = {
  me: ['me'],
  access: ['access'],
  accounts: ['accounts'],
  categories: ['categories'],
  transactions: ['transactions'],
  summary: ['summary'],
  budgets: ['budgets'],
  planner: ['planner'],
  savings: ['savings'],
  wealth: ['wealth'],
  scenarios: ['scenarios'],
  members: ['members'],
  chores: ['chores'],
  shopping: ['shopping'],
  preferences: ['preferences'],
} as const;

export const queryKeys = {
  me: roots.me,
  accounts: roots.accounts,
  accountTotals: [...roots.accounts, 'totals'] as const,
  categories: roots.categories,
  transactionsRoot: roots.transactions,
  transactions: (query: TransactionQueryInput) => [...roots.transactions, query] as const,
  summaryRoot: roots.summary,
  summary: (month: string) => [...roots.summary, month] as const,
  budgetsRoot: roots.budgets,
  budgets: (month: string) => [...roots.budgets, month] as const,
};

/**
 * Money changed (an operation, a payment mark, a fund movement, an account): everything that
 * shows balances, plans or totals is refetched — lists, accounts, analytics, budgets, the planner,
 * funds, wealth and scenarios. One function, so no screen is left with stale money.
 */
export async function invalidateMoney(client: QueryClient): Promise<void> {
  await Promise.all(
    [
      roots.transactions,
      roots.summary,
      roots.accounts,
      roots.budgets,
      roots.planner,
      roots.savings,
      roots.wealth,
      roots.scenarios,
    ].map((queryKey) => client.invalidateQueries({ queryKey })),
  );
}
