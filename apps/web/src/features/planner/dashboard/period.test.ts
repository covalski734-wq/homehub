import type { PlannerTrendPointDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import { fromCents, toCents } from '@/lib/money';
import { change, monthProgress, parsePeriod, summarize } from './period';

const point = (
  month: string,
  free: string,
  breakdown: PlannerTrendPointDto['breakdown'] = [],
): PlannerTrendPointDto => ({
  month,
  grossIncome: '1000.10',
  deductions: '0.10',
  netIncome: '1000.00',
  recurring: '300.33',
  purchases: '0.00',
  savingsTarget: '200.00',
  free,
  savingsRate: '20.00',
  breakdown,
});

describe('dashboard period', () => {
  it('converts decimal strings to cents and back exactly', () => {
    expect(toCents('1234.5')).toBe(123450n);
    expect(toCents('-0.07')).toBe(-7n);
    expect(fromCents(-7n)).toBe('-0.07');
    expect(fromCents(toCents('0.10') + toCents('0.20'))).toBe('0.30');
  });

  it('sums the selected months only, in cents, with categories merged', () => {
    const points = [
      point('2026-07', '499.67', [{ key: 'HOUSING', kind: 'recurring', amount: '300.33' }]),
      point('2026-08', '-12.01', [
        { key: 'HOUSING', kind: 'recurring', amount: '300.33' },
        { key: 'PURCHASES', kind: 'purchases', amount: '700.00' },
      ]),
      point('2026-09', '499.67', [{ key: 'HOUSING', kind: 'recurring', amount: '300.33' }]),
    ];
    const summary = summarize(points, '2026-09', 2);
    expect(summary.from).toBe('2026-08');
    expect(summary.months.map((m) => m.month)).toEqual(['2026-08', '2026-09']);
    expect(summary.totals.recurring).toBe('600.66');
    expect(summary.totals.free).toBe('487.66');
    expect(summary.totals.grossIncome).toBe('2000.20');
    expect(summary.breakdown).toEqual([
      { key: 'PURCHASES', kind: 'purchases', amount: '700.00' },
      { key: 'HOUSING', kind: 'recurring', amount: '600.66' },
    ]);
    // One month equals that month's own totals.
    expect(summarize(points, '2026-07', 1).totals.free).toBe('499.67');
  });

  it('parses the period from the URL and compares periods', () => {
    expect(parsePeriod('6')).toBe(6);
    expect(parsePeriod('5')).toBe(1);
    expect(parsePeriod(null)).toBe(1);
    expect(change('110', '100')).toBeCloseTo(0.1);
    expect(change('10', '0')).toBeNull();
    expect(change('10', undefined)).toBeNull();
  });
});

describe('monthProgress', () => {
  const now = new Date(2026, 9, 12, 15, 0);
  it('counts passed days of the current month, today included', () => {
    expect(monthProgress('2026-10', now)).toMatchObject({ passed: 12, days: 31, share: 12 / 31 });
  });
  it('treats past months as fully passed and future months as not started', () => {
    expect(monthProgress('2026-02', now)).toMatchObject({ passed: 28, days: 28, share: 1 });
    expect(monthProgress('2026-11', now)).toMatchObject({ passed: 0, days: 30, share: 0 });
  });
  it('counts only the spending window', () => {
    const ads = { startDay: 10, endDay: 25 };
    expect(monthProgress('2026-10', now, ads)).toMatchObject({ passed: 3, days: 16 });
    expect(monthProgress('2026-10', new Date(2026, 9, 5), ads)).toMatchObject({ passed: 0 });
    expect(monthProgress('2026-10', new Date(2026, 9, 28), ads)).toMatchObject({ share: 1 });
    expect(monthProgress('2026-11', new Date(2026, 10, 30), { endDay: 31 })).toMatchObject({
      days: 30,
      share: 1,
    });
  });
});
