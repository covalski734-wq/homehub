import type { BudgetBreakdownDto, PlannerTrendPointDto } from '@homehub/shared';
import { centsToNumber, divRound, fromCents, toCents } from '@/lib/money';
import { spending } from './period';

/**
 * Numbers behind the dashboard charts. Sums and averages are exact in cents; recharts gets plain
 * numbers only at the end (`centsToNumber`), for drawing.
 */

/** One chart row: the month plus a number per series key. */
export type ChartRow = { month: string } & Record<string, string | number>;

/** Whole percent of `part` in `whole` (rounded half up), 0 without a whole. */
export function percentOf(part: bigint, whole: bigint): number {
  return whole > 0n ? Number(divRound(part * 100n, whole)) : 0;
}

export interface StructureItem {
  key: string;
  kind: BudgetBreakdownDto['kind'];
  cents: bigint;
  /** Share of all spending, whole percent. */
  percent: number;
  /** Width against the largest item (0…100), for the bars. */
  barPercent: number;
}

/** Spending by category (already sorted, largest first, by the server or `summarize`). */
export function structure(breakdown: BudgetBreakdownDto[]): {
  items: StructureItem[];
  total: bigint;
} {
  const cents = breakdown.map((b) => toCents(b.amount));
  const total = cents.reduce((s, c) => s + c, 0n);
  const max = cents[0] ?? 0n;
  const items = breakdown.map((b, i) => {
    const value = cents[i] ?? 0n;
    return {
      key: b.key,
      kind: b.kind,
      cents: value,
      percent: percentOf(value, total),
      barPercent: widthPercent(value, max),
    };
  });
  return { items, total };
}

/** Largest categories over the months (at most `limit`); the rest is folded into «Другое». */
export function topCategories(points: PlannerTrendPointDto[], limit = 5) {
  const totals = new Map<string, bigint>();
  for (const p of points)
    for (const b of p.breakdown) totals.set(b.key, (totals.get(b.key) ?? 0n) + toCents(b.amount));
  const top = [...totals.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .slice(0, limit)
    .map(([key]) => key);
  const rows = points.map((p) => {
    const sums = new Map<string, bigint>(top.map((key) => [key, 0n]));
    let other = 0n;
    for (const b of p.breakdown) {
      if (sums.has(b.key)) sums.set(b.key, toCents(b.amount));
      else other += toCents(b.amount);
    }
    const row: ChartRow = { month: p.month, OTHER_FOLD: centsToNumber(other) };
    for (const [key, value] of sums) row[key] = centsToNumber(value);
    return row;
  });
  return { top, folded: totals.size > top.length, rows };
}

export const trendRows = (points: PlannerTrendPointDto[]): ChartRow[] =>
  points.map((p) => ({
    month: p.month,
    netIncome: centsToNumber(toCents(p.netIncome)),
    spending: centsToNumber(toCents(spending(p))),
    savingsTarget: centsToNumber(toCents(p.savingsTarget)),
  }));

/** One series per month: `key` of the trend point as a chart number. */
export const seriesRows = (
  points: PlannerTrendPointDto[],
  key: 'free' | 'savingsTarget' | 'purchases',
): ChartRow[] => points.map((p) => ({ month: p.month, [key]: centsToNumber(toCents(p[key])) }));

/** Average free money per month (exact, rounded to cents) and how many months went negative. */
export function balanceStats(points: PlannerTrendPointDto[]) {
  const free = points.map((p) => toCents(p.free));
  const sum = free.reduce((s, c) => s + c, 0n);
  return {
    average: fromCents(divRound(sum, BigInt(Math.max(free.length, 1)))),
    negativeMonths: free.filter((c) => c < 0n).length,
  };
}

export const savingsTotal = (points: PlannerTrendPointDto[]) =>
  fromCents(points.reduce((s, p) => s + toCents(p.savingsTarget), 0n));

/** Percent of `part` in `whole` with two decimals, for bar widths; 0 without a whole. */
export function widthPercent(part: bigint, whole: bigint): number {
  return whole > 0n ? Number((part * 10_000n) / whole) / 100 : 0;
}
