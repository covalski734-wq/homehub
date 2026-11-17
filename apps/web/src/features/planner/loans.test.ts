import type { LoanDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import { isClosed, loansSummary, repaidPercent } from './loans';

const loan = (over: Partial<LoanDto>): LoanDto => ({
  id: 'l1',
  name: 'Кредит',
  currency: 'PLN',
  startMonth: '2026-01',
  endMonth: '2026-12',
  intervalMonths: 1,
  payment: '100.00',
  paymentsTotal: 12,
  paymentsPaid: 4,
  total: '1200.00',
  paid: '400.00',
  remaining: '800.00',
  nextMonth: '2026-05',
  totalIsManual: false,
  paymentBase: '100.00',
  remainingBase: '800.00',
  ...over,
});

// Expected values are what the previous floating-point version showed.
describe('loans', () => {
  it('shows the repaid share, capped at 100 %', () => {
    expect(repaidPercent(loan({}))).toBe(33.33);
    expect(Math.round(repaidPercent(loan({})))).toBe(33);
    expect(repaidPercent(loan({ paid: '1300.00' }))).toBe(100);
    expect(repaidPercent(loan({ total: null }))).toBe(0);
    expect(repaidPercent(loan({ total: '0' }))).toBe(0);
  });

  it('treats a zero remainder as closed', () => {
    expect(isClosed(loan({ remaining: '0.00' }))).toBe(true);
    expect(isClosed(loan({ remaining: null }))).toBe(false);
    expect(isClosed(loan({}))).toBe(false);
  });

  it('sums what is left and the monthly load of open loans', () => {
    const summary = loansSummary([
      loan({ id: 'a' }),
      // Quarterly 100.00 → 33.333… a month; three such loans add up to exactly 100.00.
      loan({ id: 'b', intervalMonths: 3, paymentBase: '100.00', remainingBase: '200.10' }),
      loan({ id: 'c', intervalMonths: 3, paymentBase: '100.00', remainingBase: null }),
      loan({ id: 'd', intervalMonths: 3, paymentBase: '100.00', nextMonth: null }),
      loan({ id: 'e', remaining: '0.00', remainingBase: '0.00' }),
    ]);
    expect(summary.open.map((l) => l.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(summary.closed.map((l) => l.id)).toEqual(['e']);
    expect(summary.remaining).toBe('1800.10');
    // 100 + 33.33… + 33.33… (d has no next payment) = 166.67
    expect(summary.monthly).toBe('166.67');
  });
});
