import { describe, expect, it } from 'vitest';
import {
  amountForMonth,
  bpToPercent,
  budgetTotals,
  convert,
  applyDeductions,
  divRound,
  microsToRate,
  occursInMonth,
  percentToBp,
  purchaseBudgetEntry,
  rateToMicros,
  resolveMonthValue,
  type DeductionRule,
} from '../../src/planner/calculations';

const rates = new Map([
  ['EUR', rateToMicros('4.2615')],
  ['USD', rateToMicros('3.6721')],
  ['CAD', rateToMicros('2.6503')],
]);

describe('schedules', () => {
  it('repeats monthly, quarterly and yearly from the start month', () => {
    const quarterly = { startMonth: '2026-01', endMonth: null, intervalMonths: 3 };
    expect(
      ['2026-01', '2026-02', '2026-04', '2027-01'].map((m) => occursInMonth(quarterly, m)),
    ).toEqual([true, false, true, true]);
    const yearly = { startMonth: '2025-09', endMonth: null, intervalMonths: 12 };
    expect(occursInMonth(yearly, '2026-09')).toBe(true);
    expect(occursInMonth(yearly, '2026-10')).toBe(false);
  });

  it('respects the period, e.g. an installment plan that ends', () => {
    const installment = { startMonth: '2026-01', endMonth: '2026-06', intervalMonths: 1 };
    expect(occursInMonth(installment, '2025-12')).toBe(false);
    expect(occursInMonth(installment, '2026-06')).toBe(true);
    expect(occursInMonth(installment, '2026-07')).toBe(false);
  });
});

describe('amount history', () => {
  const history = [
    { effectiveMonth: '2026-01', amountMinor: 300000 },
    { effectiveMonth: '2026-05', amountMinor: 320000 },
  ];

  it('changes from a month on without touching earlier months', () => {
    expect(amountForMonth(history, '2026-04')).toBe(300000n);
    expect(amountForMonth(history, '2026-05')).toBe(320000n);
    expect(amountForMonth(history, '2027-01')).toBe(320000n);
    expect(amountForMonth(history, '2025-11')).toBe(300000n);
  });

  it('applies one-month overrides and skips only to their month', () => {
    const schedule = { startMonth: '2026-01', endMonth: null, intervalMonths: 1 };
    expect(
      resolveMonthValue(schedule, history, { amountMinor: 1, skipped: false }, '2026-03'),
    ).toEqual({
      active: true,
      skipped: false,
      overridden: true,
      amount: 1n,
    });
    expect(
      resolveMonthValue(schedule, history, { amountMinor: null, skipped: true }, '2026-03'),
    ).toMatchObject({
      active: false,
      skipped: true,
      amount: 0n,
    });
    expect(resolveMonthValue(schedule, history, undefined, '2025-12')).toMatchObject({
      active: false,
      amount: 0n,
    });
  });
});

describe('deductions', () => {
  const rule = (r: Partial<DeductionRule>): DeductionRule => ({
    kind: 'PERCENT',
    rateBp: null,
    base: 'GROSS',
    amountMinor: null,
    currency: null,
    startMonth: null,
    endMonth: null,
    ...r,
  });
  const fixed = (r: DeductionRule) => BigInt(r.amountMinor ?? 0);

  it('computes configurable percentage and fixed deductions', () => {
    const gross = 1_000_000n; // 10 000.00
    const tax = rule({ rateBp: 1200 });
    const fee = rule({ kind: 'FIXED', amountMinor: 2500, startMonth: '2026-03' });
    expect(applyDeductions([tax, fee], gross, '2026-01', fixed)).toEqual([120_000n, 0n]);
    expect(applyDeductions([tax, fee], gross, '2026-03', fixed)).toEqual([120_000n, 2_500n]);
    expect(applyDeductions([fee], 0n, '2026-03', fixed)).toEqual([0n]);
  });

  it('rounds percentages half up to the cent', () => {
    expect(applyDeductions([rule({ rateBp: 1950 })], 333n, '2026-01', fixed)).toEqual([65n]); // 64.935 → 65
  });

  it('applies a percentage to the remainder after the deductions before it', () => {
    // Spreadsheet formula (2300 EUR × 4.31 − 550 PLN) × (1 − 6 %) = 8 801.22 PLN on the base side.
    const commission = rule({ kind: 'FIXED', amountMinor: 55_000, currency: 'PLN' });
    const tax = rule({ rateBp: 600, base: 'REMAINDER' });
    const grossPln = 991_300n;
    const [c, t] = applyDeductions([commission, tax], grossPln, '2026-10', fixed);
    expect([c, t]).toEqual([55_000n, 56_178n]);
    expect(grossPln - c! - t!).toBe(880_122n);
    // The same tax on the gross would be 594.78.
    expect(applyDeductions([rule({ rateBp: 600 })], grossPln, '2026-10', fixed)).toEqual([59_478n]);
  });

  it('makes later remainder percentages unknown when a fixed amount has no rate', () => {
    const commission = rule({ kind: 'FIXED', amountMinor: 100, currency: 'CAD' });
    const tax = rule({ rateBp: 1000, base: 'REMAINDER' });
    const gross = rule({ rateBp: 1000 });
    expect(applyDeductions([commission, tax, gross], 10_000n, '2026-01', () => null)).toEqual([
      null,
      null,
      1_000n,
    ]);
  });
});

describe('currency conversion', () => {
  it('converts through PLN with a single rounding', () => {
    expect(convert(10_000n, 'EUR', 'PLN', rates)).toBe(42_615n); // 100 EUR → 426.15 PLN
    expect(convert(42_615n, 'PLN', 'EUR', rates)).toBe(10_000n);
    expect(convert(10_000n, 'USD', 'EUR', rates)).toBe(8_617n); // 100 × 3.6721 / 4.2615 = 86.169…
    expect(convert(1n, 'CAD', 'PLN', rates)).toBe(3n);
    expect(convert(500n, 'PLN', 'PLN', rates)).toBe(500n);
  });

  it('reports a missing rate instead of guessing', () => {
    expect(convert(100n, 'USD', 'PLN', new Map())).toBeNull();
  });

  it('keeps rates exact', () => {
    expect(rateToMicros('4.2615')).toBe(4_261_500n);
    expect(rateToMicros('0.026845')).toBe(26_845n);
    expect(microsToRate(4_261_500n)).toBe('4.2615');
    expect(microsToRate(26_845n)).toBe('0.026845');
    expect(divRound(-5n, 2n)).toBe(-3n);
  });
});

describe('percentages', () => {
  it('round-trips basis points', () => {
    expect(percentToBp('20')).toBe(2000);
    expect(percentToBp('12.5')).toBe(1250);
    expect(percentToBp('0.05')).toBe(5);
    expect(bpToPercent(2000)).toBe('20.00');
    expect(bpToPercent(1250)).toBe('12.50');
  });
});

describe('purchases in budgets', () => {
  const base = { estimatedAmountMinor: 100_000, actualAmountMinor: null, purchasedOn: null };

  it('counts a planned purchase once, in its planned month, with the estimate', () => {
    expect(purchaseBudgetEntry({ ...base, status: 'ACTIVE', plannedMonth: '2026-11' })).toEqual({
      month: '2026-11',
      amount: 100_000n,
    });
  });

  it('keeps a purchase planned for November in November even when bought in December', () => {
    expect(
      purchaseBudgetEntry({
        ...base,
        status: 'PURCHASED',
        plannedMonth: '2026-11',
        purchasedOn: '2026-12-03',
        actualAmountMinor: 95_000,
      }),
    ).toEqual({ month: '2026-11', amount: 95_000n });
  });

  it('places an unplanned purchase in the month it was bought', () => {
    expect(
      purchaseBudgetEntry({
        ...base,
        status: 'PURCHASED',
        plannedMonth: null,
        purchasedOn: '2026-12-03',
        actualAmountMinor: 5,
      }),
    ).toEqual({ month: '2026-12', amount: 5n });
  });

  it('ignores cancelled and unscheduled wishes', () => {
    expect(
      purchaseBudgetEntry({ ...base, status: 'CANCELLED', plannedMonth: '2026-11' }),
    ).toBeNull();
    expect(purchaseBudgetEntry({ ...base, status: 'ACTIVE', plannedMonth: null })).toBeNull();
  });
});

describe('budget totals', () => {
  it('derives savings and the free remainder from net income', () => {
    expect(
      budgetTotals({
        grossIncome: 1_000_000n,
        deductions: 120_000n,
        recurring: 400_000n,
        purchases: 50_000n,
        savingsRateBp: 2000,
      }),
    ).toEqual({
      grossIncome: 1_000_000n,
      deductions: 120_000n,
      netIncome: 880_000n,
      recurring: 400_000n,
      purchases: 50_000n,
      savingsTarget: 176_000n,
      free: 254_000n,
    });
  });

  it('never targets savings from a negative income', () => {
    expect(
      budgetTotals({
        grossIncome: 0n,
        deductions: 100n,
        recurring: 0n,
        purchases: 0n,
        savingsRateBp: 2000,
      }).savingsTarget,
    ).toBe(0n);
  });
});
