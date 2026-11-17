import type { PurchaseStatus } from '@homehub/shared';

/**
 * Pure planner math. Money is bigint minor units, rates are bigint micro-units
 * (PLN per currency unit × 1 000 000), percentages are basis points (20 % = 2000).
 * Rounding happens once, at the end of each conversion, half away from zero.
 */

export const PLN_MICROS = 1_000_000n;

export function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;
}

export function isInPeriod(month: string, start: string | null, end: string | null): boolean {
  return (start === null || month >= start) && (end === null || month <= end);
}

export interface Schedule {
  startMonth: string;
  endMonth: string | null;
  intervalMonths: number;
}

/** Due every `intervalMonths` months counted from the start month, inside the period. */
export function occursInMonth(schedule: Schedule, month: string): boolean {
  if (!isInPeriod(month, schedule.startMonth, schedule.endMonth)) return false;
  return (monthIndex(month) - monthIndex(schedule.startMonth)) % schedule.intervalMonths === 0;
}

export interface AmountEntry {
  effectiveMonth: string;
  amountMinor: number;
}

/**
 * Amount valid in `month`: the latest entry effective at or before it. Months before the first
 * entry (e.g. after the start was moved earlier) use the first entry.
 */
export function amountForMonth(history: readonly AmountEntry[], month: string): bigint {
  let current: AmountEntry | undefined;
  let earliest: AmountEntry | undefined;
  for (const entry of history) {
    if (!earliest || entry.effectiveMonth < earliest.effectiveMonth) earliest = entry;
    if (
      entry.effectiveMonth <= month &&
      (!current || entry.effectiveMonth > current.effectiveMonth)
    ) {
      current = entry;
    }
  }
  return BigInt((current ?? earliest)?.amountMinor ?? 0);
}

export interface Override {
  amountMinor: number | null;
  skipped: boolean;
}

export interface ResolvedMonthValue {
  active: boolean;
  skipped: boolean;
  overridden: boolean;
  amount: bigint;
}

export function resolveMonthValue(
  schedule: Schedule,
  history: readonly AmountEntry[],
  override: Override | undefined,
  month: string,
): ResolvedMonthValue {
  const due = occursInMonth(schedule, month);
  const skipped = due && Boolean(override?.skipped);
  const overridden =
    due && !skipped && override?.amountMinor !== null && override?.amountMinor !== undefined;
  const amount =
    !due || skipped
      ? 0n
      : overridden
        ? BigInt(override!.amountMinor!)
        : amountForMonth(history, month);
  return { active: due && !skipped, skipped, overridden, amount };
}

/** Division rounding half away from zero (bankers' rounding is not used in household budgets). */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error('Division by zero');
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = (n * 2n + d) / (d * 2n);
  return negative ? -q : q;
}

export function percentOf(amount: bigint, basisPoints: number): bigint {
  return divRound(amount * BigInt(basisPoints), 10_000n);
}

export interface DeductionRule {
  kind: 'PERCENT' | 'FIXED';
  rateBp: number | null;
  /** PERCENT: of the gross income, or of what is left after the rules before it. */
  base: 'GROSS' | 'REMAINDER';
  amountMinor: number | null;
  /** FIXED: currency of the amount; null means the income currency. */
  currency: string | null;
  startMonth: string | null;
  endMonth: string | null;
}

/**
 * Deductions of one month, in rule order, all in one currency (the one `gross` is in).
 * `fixedAmount` converts a fixed rule into that currency (null without a rate). A missing amount
 * also makes every later REMAINDER percentage unknown. Percentages of a negative remainder are 0.
 */
export function applyDeductions(
  rules: readonly DeductionRule[],
  gross: bigint,
  month: string,
  fixedAmount: (rule: DeductionRule) => bigint | null,
): (bigint | null)[] {
  let remainder: bigint | null = gross;
  return rules.map((rule) => {
    if (!isInPeriod(month, rule.startMonth, rule.endMonth) || gross === 0n) return 0n;
    let amount: bigint | null;
    if (rule.kind === 'FIXED') amount = fixedAmount(rule);
    else if (rule.base === 'GROSS') amount = percentOf(gross, rule.rateBp ?? 0);
    else amount = remainder === null ? null : percentOf(max0(remainder), rule.rateBp ?? 0);
    remainder = remainder === null || amount === null ? null : remainder - amount;
    return amount;
  });
}

const max0 = (value: bigint) => (value < 0n ? 0n : value);

/** Rates map: currency → PLN micro-units for one unit. PLN itself is implicit. */
export type RateTable = ReadonlyMap<string, bigint>;

function plnRate(currency: string, rates: RateTable): bigint | null {
  return currency === 'PLN' ? PLN_MICROS : (rates.get(currency) ?? null);
}

/**
 * Converts through PLN (NBP publishes everything against PLN):
 * target = amount × rate(from) / rate(to), rounded once. Returns null without a rate.
 */
export function convert(amount: bigint, from: string, to: string, rates: RateTable): bigint | null {
  if (from === to) return amount;
  const fromRate = plnRate(from, rates);
  const toRate = plnRate(to, rates);
  if (fromRate === null || toRate === null) return null;
  return divRound(amount * fromRate, toRate);
}

export function savingsTarget(netIncome: bigint, rateBp: number): bigint {
  return netIncome > 0n ? percentOf(netIncome, rateBp) : 0n;
}

export interface PurchaseForBudget {
  status: PurchaseStatus;
  plannedMonth: string | null;
  purchasedOn: string | null;
  estimatedAmountMinor: number;
  actualAmountMinor: number | null;
}

/**
 * The single month whose budget contains the purchase, and the amount it contributes:
 * the planned month (or the purchase month if it was bought unplanned); the actual price once
 * bought, the estimate before. Cancelled or unscheduled wishes belong to no month.
 */
export function purchaseBudgetEntry(
  purchase: PurchaseForBudget,
): { month: string; amount: bigint } | null {
  if (purchase.status === 'CANCELLED') return null;
  if (purchase.status === 'PURCHASED') {
    const month = purchase.plannedMonth ?? purchase.purchasedOn?.slice(0, 7) ?? null;
    return month ? { month, amount: BigInt(purchase.actualAmountMinor ?? 0) } : null;
  }
  return purchase.plannedMonth
    ? { month: purchase.plannedMonth, amount: BigInt(purchase.estimatedAmountMinor) }
    : null;
}

export interface BudgetTotals {
  grossIncome: bigint;
  deductions: bigint;
  netIncome: bigint;
  recurring: bigint;
  purchases: bigint;
  savingsTarget: bigint;
  free: bigint;
}

export function budgetTotals(input: {
  grossIncome: bigint;
  deductions: bigint;
  recurring: bigint;
  purchases: bigint;
  savingsRateBp: number;
}): BudgetTotals {
  const netIncome = input.grossIncome - input.deductions;
  const target = savingsTarget(netIncome, input.savingsRateBp);
  return {
    grossIncome: input.grossIncome,
    deductions: input.deductions,
    netIncome,
    recurring: input.recurring,
    purchases: input.purchases,
    savingsTarget: target,
    free: netIncome - input.recurring - input.purchases - target,
  };
}

/** "20", "12.5", "12.50" → basis points. Input is pre-validated by percentSchema. */
export function percentToBp(value: string): number {
  const [units = '0', fraction = ''] = value.split('.');
  return Number(units) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

export function bpToPercent(bp: number): string {
  return `${Math.floor(bp / 100)}.${String(bp % 100).padStart(2, '0')}`;
}

/** NBP mid rate as published ("4.2615") → micro-units, exactly. */
export function rateToMicros(rate: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(rate.trim());
  if (!match) throw new Error(`Unsupported rate format: ${rate}`);
  return BigInt(match[1]!) * PLN_MICROS + BigInt((match[2] ?? '').padEnd(6, '0'));
}

export function microsToRate(micros: bigint | number): string {
  const value = BigInt(micros);
  const fraction = (value % PLN_MICROS)
    .toString()
    .padStart(6, '0')
    .replace(/0{1,2}$/, '');
  return `${value / PLN_MICROS}.${fraction.length < 4 ? fraction.padEnd(4, '0') : fraction}`;
}
