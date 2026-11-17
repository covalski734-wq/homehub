import {
  daysInMonth,
  type BalanceDto,
  type CategorySpendingDto,
  type CurrencyTotalsDto,
  type DailyPointDto,
  type MonthlyPointDto,
  type TransactionType,
} from '@homehub/shared';
import { formatMinor, ratio } from '../lib/money';

/**
 * Pure financial math on integer minor units (bigint). Rules:
 * - money is never a floating point number;
 * - amounts in different currencies are never added together;
 * - TRANSFER moves money between own accounts: it changes account balances
 *   but is neither income nor expense.
 */

export interface FlowRow {
  /** Calendar date "YYYY-MM-DD". */
  date: string;
  currency: string;
  type: TransactionType;
  amount: bigint;
}

interface IncomeExpense {
  income: bigint;
  expense: bigint;
}

function emptyTotals(): IncomeExpense {
  return { income: 0n, expense: 0n };
}

function addFlow(target: IncomeExpense, row: FlowRow): IncomeExpense {
  if (row.type === 'INCOME') return { ...target, income: target.income + row.amount };
  if (row.type === 'EXPENSE') return { ...target, expense: target.expense + row.amount };
  return target;
}

function isIncomeOrExpense(row: FlowRow): boolean {
  return row.type === 'INCOME' || row.type === 'EXPENSE';
}

function byCurrency(a: { currency: string }, b: { currency: string }): number {
  return a.currency.localeCompare(b.currency);
}

export function summarizeByCurrency(rows: FlowRow[]): CurrencyTotalsDto[] {
  const totals = new Map<string, IncomeExpense>();
  for (const row of rows.filter(isIncomeOrExpense)) {
    totals.set(row.currency, addFlow(totals.get(row.currency) ?? emptyTotals(), row));
  }
  return [...totals.entries()]
    .map(([currency, { income, expense }]) => ({
      currency,
      income: formatMinor(income),
      expense: formatMinor(expense),
      net: formatMinor(income - expense),
    }))
    .sort(byCurrency);
}

/** One point per day of the month for every currency that has activity in that month. */
export function buildDailySeries(rows: FlowRow[], month: string): DailyPointDto[] {
  const monthRows = rows.filter((row) => row.date.startsWith(month) && isIncomeOrExpense(row));
  const currencies = [...new Set(monthRows.map((row) => row.currency))].sort();
  const buckets = new Map<string, IncomeExpense>();
  for (const row of monthRows) {
    const key = `${row.currency}|${row.date}`;
    buckets.set(key, addFlow(buckets.get(key) ?? emptyTotals(), row));
  }

  const points: DailyPointDto[] = [];
  for (const currency of currencies) {
    for (let day = 1; day <= daysInMonth(month); day += 1) {
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const bucket = buckets.get(`${currency}|${date}`) ?? emptyTotals();
      points.push({
        date,
        currency,
        income: formatMinor(bucket.income),
        expense: formatMinor(bucket.expense),
      });
    }
  }
  return points;
}

/** Income/expense per month for the given (ordered) months, per currency. */
export function buildMonthlyTrend(rows: FlowRow[], months: string[]): MonthlyPointDto[] {
  const relevant = rows.filter(
    (row) => isIncomeOrExpense(row) && months.includes(row.date.slice(0, 7)),
  );
  const currencies = [...new Set(relevant.map((row) => row.currency))].sort();
  const buckets = new Map<string, IncomeExpense>();
  for (const row of relevant) {
    const key = `${row.currency}|${row.date.slice(0, 7)}`;
    buckets.set(key, addFlow(buckets.get(key) ?? emptyTotals(), row));
  }
  return currencies.flatMap((currency) =>
    months.map((month) => {
      const bucket = buckets.get(`${currency}|${month}`) ?? emptyTotals();
      return {
        month,
        currency,
        income: formatMinor(bucket.income),
        expense: formatMinor(bucket.expense),
      };
    }),
  );
}

export interface CategoryAmountRow {
  categoryId: string;
  currency: string;
  amount: bigint;
}

export function buildCategorySpending(
  rows: CategoryAmountRow[],
  categories: ReadonlyMap<string, { name: string; color: string; systemKey: string | null }>,
): CategorySpendingDto[] {
  const totalByCurrency = new Map<string, bigint>();
  for (const row of rows) {
    totalByCurrency.set(row.currency, (totalByCurrency.get(row.currency) ?? 0n) + row.amount);
  }
  return rows
    .filter((row) => row.amount > 0n)
    .sort((a, b) => byCurrency(a, b) || (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0))
    .map((row) => {
      const category = categories.get(row.categoryId);
      return {
        categoryId: row.categoryId,
        // Without a category the name is empty: the client says «Без категории» in its language.
        name: category?.name ?? '',
        systemKey: category?.systemKey ?? null,
        color: category?.color ?? '#6b7280',
        currency: row.currency,
        amount: formatMinor(row.amount),
        share: ratio(row.amount, totalByCurrency.get(row.currency) ?? 0n),
      };
    });
}

export interface AccountFlows {
  income: bigint;
  expense: bigint;
  transferOut: bigint;
  transferIn: bigint;
}

export function emptyAccountFlows(): AccountFlows {
  return { income: 0n, expense: 0n, transferOut: 0n, transferIn: 0n };
}

export interface OutgoingFlowRow {
  accountId: string;
  type: TransactionType;
  amount: bigint;
}

export interface IncomingTransferRow {
  toAccountId: string;
  amount: bigint;
}

export function collectAccountFlows(
  outgoing: OutgoingFlowRow[],
  incoming: IncomingTransferRow[],
): Map<string, AccountFlows> {
  const flows = new Map<string, AccountFlows>();
  const get = (id: string) => flows.get(id) ?? emptyAccountFlows();
  for (const row of outgoing) {
    const current = get(row.accountId);
    const field =
      row.type === 'INCOME' ? 'income' : row.type === 'EXPENSE' ? 'expense' : 'transferOut';
    flows.set(row.accountId, { ...current, [field]: current[field] + row.amount });
  }
  for (const row of incoming) {
    const current = get(row.toAccountId);
    flows.set(row.toAccountId, { ...current, transferIn: current.transferIn + row.amount });
  }
  return flows;
}

export function computeBalance(initialBalance: bigint, flows: AccountFlows): bigint {
  return initialBalance + flows.income - flows.expense - flows.transferOut + flows.transferIn;
}

export function sumBalancesByCurrency(
  accounts: { currency: string; balance: bigint }[],
): BalanceDto[] {
  const totals = new Map<string, bigint>();
  for (const account of accounts) {
    totals.set(account.currency, (totals.get(account.currency) ?? 0n) + account.balance);
  }
  return [...totals.entries()]
    .map(([currency, total]) => ({ currency, total: formatMinor(total) }))
    .sort(byCurrency);
}

export function budgetProgress(
  limit: bigint,
  spent: bigint,
): { remaining: string; progress: number } {
  return { remaining: formatMinor(limit - spent), progress: ratio(spent, limit) };
}
