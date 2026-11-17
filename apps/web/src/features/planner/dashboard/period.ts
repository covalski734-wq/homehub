import {
  currentMonth,
  shiftMonth,
  type BudgetBreakdownDto,
  type BudgetTotalsDto,
  type PlannerTrendPointDto,
} from '@homehub/shared';
import { fromCents, toCents } from '@/lib/money';

/**
 * A dashboard period: the selected month and the months before it. Totals are sums of the
 * server's month totals (each from buildMonthBudget), added exactly in cents — so a one-month
 * period always equals the month budget, and a longer one equals the sum of its months.
 */

export const PERIODS = [1, 3, 6, 12] as const;
export type PeriodLength = (typeof PERIODS)[number];

export const parsePeriod = (raw: string | null): PeriodLength =>
  PERIODS.find((length) => length === Number(raw)) ?? 1;

export interface PeriodSummary {
  from: string;
  to: string;
  months: PlannerTrendPointDto[];
  totals: BudgetTotalsDto;
  /** Category sums over the period, largest first (same keys as a month breakdown). */
  breakdown: BudgetBreakdownDto[];
}

/** Months `to − length + 1 … to` from trend points (missing months are simply absent). */
export function summarize(
  points: PlannerTrendPointDto[],
  to: string,
  length: number,
): PeriodSummary {
  const from = shiftMonth(to, -(length - 1));
  const months = points.filter((p) => p.month >= from && p.month <= to);
  const sum = (key: keyof BudgetTotalsDto) =>
    fromCents(months.reduce((s, point) => s + toCents(point[key]), 0n));
  const totals: BudgetTotalsDto = {
    grossIncome: sum('grossIncome'),
    deductions: sum('deductions'),
    netIncome: sum('netIncome'),
    recurring: sum('recurring'),
    purchases: sum('purchases'),
    savingsTarget: sum('savingsTarget'),
    free: sum('free'),
  };
  const categories = new Map<string, { kind: BudgetBreakdownDto['kind']; cents: bigint }>();
  for (const point of months) {
    for (const b of point.breakdown) {
      const entry = categories.get(b.key) ?? { kind: b.kind, cents: 0n };
      entry.cents += toCents(b.amount);
      categories.set(b.key, entry);
    }
  }
  const breakdown = [...categories.entries()]
    .sort((a, b) => (b[1].cents > a[1].cents ? 1 : b[1].cents < a[1].cents ? -1 : 0))
    .map(([key, v]) => ({ key, kind: v.kind, amount: fromCents(v.cents) }));
  return { from, to, months, totals, breakdown };
}

/** Relative change of `current` against `previous` (null when there is nothing to compare). */
export function change(current: string, previous: string | undefined): number | null {
  if (previous === undefined) return null;
  const before = Number(previous);
  if (before === 0) return null;
  return (Number(current) - before) / Math.abs(before);
}

/** Spending of a month: regular payments + purchases. */
export const spending = (p: { recurring: string; purchases: string }) =>
  fromCents(toCents(p.recurring) + toCents(p.purchases));

/**
 * Days of a spending window that have passed, today included: all of a past month, none of a
 * future one. The window defaults to the whole month; days past the month's end are clamped
 * (a «to the 31st» window ends on the 30th in November).
 */
export function monthProgress(
  month: string,
  now: Date = new Date(),
  window: { startDay?: number | null; endDay?: number | null } = {},
) {
  const monthDays = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const last = Math.min(window.endDay ?? monthDays, monthDays);
  const first = Math.min(window.startDay ?? 1, last);
  const days = last - first + 1;
  const current = currentMonth(now);
  const today = month < current ? monthDays : month > current ? 0 : now.getDate();
  const passed = Math.max(0, Math.min(today - first + 1, days));
  return { passed, days, share: passed / days, first, last };
}
