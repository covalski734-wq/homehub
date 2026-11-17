import type { LoanDto } from '@homehub/shared';
import { divRound, fromCents, toCents } from '@/lib/money';

/** Loan figures for the Loans page, exact in cents (the API sends decimal strings). */

export const isClosed = (loan: Pick<LoanDto, 'remaining'>) =>
  loan.remaining !== null && toCents(loan.remaining) === 0n;

/** Repaid part of the total in percent (two decimals, at most 100); 0 without a total. */
export function repaidPercent(loan: Pick<LoanDto, 'total' | 'paid'>): number {
  if (loan.total === null) return 0;
  const total = toCents(loan.total);
  if (total === 0n) return 0;
  return Math.min(100, Number((toCents(loan.paid) * 10_000n) / total) / 100);
}

const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? a : gcd(b, a % b));

/**
 * Totals over the open loans in the display currency: what is left to repay, and the monthly
 * load — each payment spread over its interval (a quarterly 300 is 100 a month). The fractions
 * are added over a common denominator, so the sum is rounded only once.
 */
export function loansSummary(loans: LoanDto[]) {
  const open = loans.filter((l) => l.remaining === null || toCents(l.remaining) > 0n);
  const closed = loans.filter(isClosed);
  const remaining = open.reduce((s, l) => s + toCents(l.remainingBase ?? '0'), 0n);
  const paying = open.filter((l) => l.nextMonth !== null);
  const denominator = paying.reduce((d, l) => {
    const n = BigInt(l.intervalMonths);
    return (d * n) / gcd(d, n);
  }, 1n);
  const monthly = paying.reduce(
    (s, l) => s + (toCents(l.paymentBase ?? '0') * denominator) / BigInt(l.intervalMonths),
    0n,
  );
  return {
    open,
    closed,
    remaining: fromCents(remaining),
    monthly: fromCents(divRound(monthly, denominator)),
  };
}
