import type {
  MonthBudgetDto,
  PlannerCurrency,
  PurchaseDto,
  RecurringLineDto,
  RemainingGroup,
} from '@homehub/shared';
import { divRound, RATE_MICROS, rateToMicros, toCents } from '@/lib/money';
import { monthProgress } from './period';

/**
 * «Left to pay» of a month as a pure model: which payments are still due, what is already paid,
 * and both in the display currency — exact cents, converted the way the server converts.
 */
export interface RemainingItem {
  key: string;
  group: RemainingGroup;
  name: string;
  amount: string;
  currency: PlannerCurrency;
  /** Amount in the display currency, in cents; null without an exchange rate. */
  base: bigint | null;
  /** Part of `base` still to pay and part already paid (an ongoing payment has both). */
  leftBase: bigint;
  doneBase: bigint;
  dueDay: number | null;
  done: boolean;
  /** Paid gradually during the month: share of the month that has passed (0…1). */
  spent?: number;
  /** Spending window of an ongoing payment (days of the month). */
  window?: ReturnType<typeof monthProgress>;
  recurring?: RecurringLineDto;
  purchase?: PurchaseDto;
}

/**
 * Converts with the month's NBP rates (PLN per unit), as the server does for budget totals:
 * amount × rate(from) / rate(to), rounded half away from zero once. Null without a rate.
 */
export function toBaseCents(
  budget: Pick<MonthBudgetDto, 'baseCurrency' | 'rates'>,
  amount: string,
  currency: PlannerCurrency,
): bigint | null {
  const cents = toCents(amount);
  if (currency === budget.baseCurrency) return cents;
  const pln = (c: string) => {
    if (c === 'PLN') return RATE_MICROS;
    const rate = budget.rates.find((r) => r.currency === c)?.rate;
    return rate === undefined ? null : rateToMicros(rate);
  };
  const from = pln(currency);
  const to = pln(budget.baseCurrency);
  if (from === null || to === null || to === 0n) return null;
  return divRound(cents * from, to);
}

/** Splits `base` by the share of the window that has passed; the two parts always add up. */
function prorate(base: bigint, passed: number, days: number) {
  const done = days > 0 ? divRound(base * BigInt(passed), BigInt(days)) : 0n;
  return { done, left: base - done };
}

export function remainingItems(
  budget: Pick<MonthBudgetDto, 'month' | 'baseCurrency' | 'rates' | 'recurring' | 'purchases'>,
  now: Date = new Date(),
): RemainingItem[] {
  const recurring = budget.recurring
    .filter((r) => r.active)
    .map<RemainingItem>((r) => {
      const base = r.base === null ? null : toCents(r.base);
      const window = r.isOngoing
        ? monthProgress(budget.month, now, {
            startDay: r.ongoingStartDay,
            endDay: r.ongoingEndDay,
          })
        : undefined;
      const split = window
        ? prorate(base ?? 0n, window.passed, window.days)
        : r.paid
          ? { done: base ?? 0n, left: 0n }
          : { done: 0n, left: base ?? 0n };
      return {
        key: `r:${r.id}`,
        group: r.isRequired ? 'required' : 'other',
        name: r.name,
        amount: r.amount,
        currency: r.currency,
        base,
        leftBase: split.left,
        doneBase: split.done,
        dueDay: r.isOngoing ? null : r.dueDay,
        done: window ? window.share >= 1 : r.paid,
        spent: window?.share,
        window,
        recurring: r,
      };
    });
  const purchases = budget.purchases
    .filter((p) => p.status !== 'CANCELLED')
    .map<RemainingItem>((p) => {
      const base = toBaseCents(budget, p.budgetAmount, p.currency);
      const done = p.status === 'PURCHASED';
      return {
        key: `p:${p.id}`,
        group: 'purchases',
        name: p.title,
        amount: p.budgetAmount,
        currency: p.currency,
        base,
        leftBase: done ? 0n : (base ?? 0n),
        doneBase: done ? (base ?? 0n) : 0n,
        dueDay: null,
        done,
        purchase: p,
      };
    });
  return [...recurring, ...purchases].sort(
    (a, b) => (a.dueDay ?? 99) - (b.dueDay ?? 99) || a.name.localeCompare(b.name),
  );
}

export const sumLeft = (items: RemainingItem[]) => items.reduce((s, i) => s + i.leftBase, 0n);
export const sumDone = (items: RemainingItem[]) => items.reduce((s, i) => s + i.doneBase, 0n);

export interface RemainingSummary {
  items: RemainingItem[];
  /** Items that count (not switched off by the user, alone or as a group). */
  counted: RemainingItem[];
  left: RemainingItem[];
  /** Paid, plus ongoing payments that are partly spent already. */
  done: RemainingItem[];
  off: RemainingItem[];
  leftSum: bigint;
  doneSum: bigint;
  total: bigint;
  /** Some counted item could not be converted to the display currency. */
  noRate: boolean;
}

export function summarizeRemaining(
  items: RemainingItem[],
  isOff: (item: RemainingItem) => boolean,
): RemainingSummary {
  const counted = items.filter((i) => !isOff(i));
  const leftSum = sumLeft(counted);
  const doneSum = sumDone(counted);
  return {
    items,
    counted,
    left: counted.filter((i) => !i.done),
    done: counted.filter((i) => i.done || (i.spent !== undefined && i.spent > 0)),
    off: items.filter(isOff),
    leftSum,
    doneSum,
    total: leftSum + doneSum,
    noRate: counted.some((i) => i.base === null),
  };
}
