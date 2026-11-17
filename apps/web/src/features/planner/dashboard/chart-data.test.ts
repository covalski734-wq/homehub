import type { BudgetBreakdownDto, PlannerTrendPointDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import {
  balanceStats,
  percentOf,
  savingsTotal,
  seriesRows,
  structure,
  topCategories,
  trendRows,
  widthPercent,
} from './chart-data';

// Expected values are what the previous floating-point charts showed for the same data.

const point = (
  month: string,
  over: Partial<PlannerTrendPointDto> = {},
  breakdown: [string, string][] = [],
): PlannerTrendPointDto => ({
  month,
  grossIncome: '0',
  netIncome: '1000.00',
  deductions: '0',
  recurring: '300.10',
  purchases: '100.20',
  savingsTarget: '100.00',
  free: '0',
  savingsRate: '10',
  breakdown: breakdown.map(([key, amount]) => ({ key, kind: 'recurring', amount })),
  ...over,
});

describe('percentages', () => {
  it('rounds whole percents half up and keeps two decimals for widths', () => {
    expect(percentOf(1n, 3n)).toBe(33);
    expect(percentOf(1n, 8n)).toBe(13);
    expect(percentOf(5n, 0n)).toBe(0);
    expect(widthPercent(1n, 3n)).toBe(33.33);
  });
});

describe('structure', () => {
  it('gives each category its share and bar width against the largest', () => {
    const breakdown: BudgetBreakdownDto[] = [
      { key: 'HOUSING', kind: 'recurring', amount: '600.00' },
      { key: 'PURCHASES', kind: 'purchases', amount: '300.00' },
      { key: 'FOOD', kind: 'recurring', amount: '100.00' },
    ];
    const { items, total } = structure(breakdown);
    expect(total).toBe(100000n);
    expect(items.map((i) => [i.key, i.percent, i.barPercent])).toEqual([
      ['HOUSING', 60, 100],
      ['PURCHASES', 30, 50],
      ['FOOD', 10, 16.66],
    ]);
  });
});

describe('topCategories', () => {
  it('keeps the largest categories and folds the rest per month', () => {
    const points = [
      point('2026-09', {}, [
        ['HOUSING', '500.00'],
        ['FOOD', '0.10'],
        ['TRANSPORT', '0.20'],
      ]),
      point('2026-10', {}, [
        ['HOUSING', '500.00'],
        ['SUBSCRIPTIONS', '40.00'],
      ]),
    ];
    const { top, folded, rows } = topCategories(points, 2);
    expect(top).toEqual(['HOUSING', 'SUBSCRIPTIONS']);
    expect(folded).toBe(true);
    // 0.10 + 0.20 is exactly 0.30 (floats gave 0.30000000000000004).
    expect(rows[0]).toEqual({ month: '2026-09', HOUSING: 500, SUBSCRIPTIONS: 0, OTHER_FOLD: 0.3 });
    expect(rows[1]).toEqual({ month: '2026-10', HOUSING: 500, SUBSCRIPTIONS: 40, OTHER_FOLD: 0 });
  });
});

describe('series', () => {
  it('draws income, spending and savings per month', () => {
    expect(trendRows([point('2026-10')])).toEqual([
      { month: '2026-10', netIncome: 1000, spending: 400.3, savingsTarget: 100 },
    ]);
    expect(seriesRows([point('2026-10', { free: '-5.50' })], 'free')).toEqual([
      { month: '2026-10', free: -5.5 },
    ]);
  });

  it('averages the free money and counts months over budget', () => {
    const points = [
      point('2026-08', { free: '100.00' }),
      point('2026-09', { free: '-50.00' }),
      point('2026-10', { free: '0.01' }),
    ];
    // (100 − 50 + 0.01) / 3 = 16.67
    expect(balanceStats(points)).toEqual({ average: '16.67', negativeMonths: 1 });
    expect(balanceStats([])).toEqual({ average: '0.00', negativeMonths: 0 });
    expect(savingsTotal(points)).toBe('300.00');
  });
});
