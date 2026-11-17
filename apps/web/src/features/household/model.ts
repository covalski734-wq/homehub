import { addMoney, moneySign, percentOf, subtractMoney } from '../savings/model';
import { toCents } from '@/lib/money';

/**
 * A typed share percentage ("49,9", "33.33") in hundredths of a percent, as an integer: shares
 * are summed and compared with 100% exactly (49.9 + 49.8 + 0.3 is 100). More than two decimals
 * round half up; anything that is not a number counts as zero, like an empty field.
 */
export function shareHundredths(value: string | undefined): number {
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec((value ?? '').trim().replace(',', '.'));
  if (!match) return 0;
  const [, minus = '', whole = '', fraction = ''] = match;
  if (whole === '' && fraction === '') return 0;
  const digits = fraction.padEnd(3, '0');
  const hundredths =
    Number(whole || '0') * 100 + Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0);
  return minus ? -hundredths : hundredths;
}

/** 100% in hundredths. */
export const FULL_SHARE = 100_00;

export function sharesTotal(values: (string | undefined)[]): number {
  return values.reduce((sum, value) => sum + shareHundredths(value), 0);
}

/** Hundredths back to a percentage for display (e.g. 9970 → 99.7). */
export const hundredthsToPercent = (hundredths: number) => hundredths / 100;

/** «Отложено»: money in funds on accounts plus money of funds outside the accounts. */
export const reservedTotal = (reserved: string, outside: string) => addMoney(reserved, outside);

/** A member's share of the capital as a bar width; never negative. */
export const capitalShare = (total: string, capital: string) =>
  Math.max(0, percentOf(total, capital));

/** Members with any money, own or set aside. */
export const hasMoney = (owner: { total: string; reserved: string }) =>
  moneySign(owner.total) !== 0 || moneySign(owner.reserved) !== 0;

/**
 * Plan against fact as two bars on one scale: the larger of both (at least 1) is the full width.
 * Overspending is a fact above a non-zero plan.
 */
export function planFactBar(plan: string, fact: string) {
  const p = toCents(plan);
  const f = toCents(fact);
  let max = 100n;
  if (p > max) max = p;
  if (f > max) max = f;
  return {
    planWidth: percentOf(plan, max),
    factWidth: percentOf(fact, max),
    over: f > p && p > 0n,
  };
}

/** Plan minus fact of a category: negative means overspent. */
export const planFactDiff = (plan: string, fact: string) => subtractMoney(plan, fact);
