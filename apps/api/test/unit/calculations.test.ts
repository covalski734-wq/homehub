import { describe, expect, it } from 'vitest';
import {
  budgetProgress,
  buildCategorySpending,
  buildDailySeries,
  buildMonthlyTrend,
  collectAccountFlows,
  computeBalance,
  summarizeByCurrency,
  sumBalancesByCurrency,
  type FlowRow,
} from '../../src/finance/calculations';
import { toMinor } from '../../src/lib/money';

const d = toMinor;

const rows: FlowRow[] = [
  { date: '2026-10-01', currency: 'RUB', type: 'INCOME', amount: d('100000.00') },
  { date: '2026-10-02', currency: 'RUB', type: 'EXPENSE', amount: d('2500.50') },
  { date: '2026-10-02', currency: 'RUB', type: 'EXPENSE', amount: d('0.10') },
  { date: '2026-10-03', currency: 'RUB', type: 'TRANSFER', amount: d('50000.00') },
  { date: '2026-10-05', currency: 'USD', type: 'EXPENSE', amount: d('19.99') },
  { date: '2026-09-15', currency: 'RUB', type: 'EXPENSE', amount: d('700.00') },
];

describe('summarizeByCurrency', () => {
  it('keeps currencies separate and ignores transfers', () => {
    expect(summarizeByCurrency(rows.filter((r) => r.date.startsWith('2026-10')))).toEqual([
      { currency: 'RUB', income: '100000.00', expense: '2500.60', net: '97499.40' },
      { currency: 'USD', income: '0.00', expense: '19.99', net: '-19.99' },
    ]);
  });

  it('has no floating point drift', () => {
    const cents: FlowRow[] = Array.from({ length: 10 }, () => ({
      date: '2026-10-01',
      currency: 'EUR',
      type: 'EXPENSE' as const,
      amount: d('0.10'),
    }));
    expect(summarizeByCurrency(cents)[0]?.expense).toBe('1.00');
  });

  it('returns an empty list when there are only transfers', () => {
    expect(summarizeByCurrency([rows[3]!])).toEqual([]);
  });
});

describe('buildDailySeries', () => {
  it('fills every day of the month for each active currency', () => {
    const series = buildDailySeries(rows, '2026-10');
    expect(series).toHaveLength(31 * 2);
    expect(series.find((p) => p.currency === 'RUB' && p.date === '2026-10-02')).toEqual({
      date: '2026-10-02',
      currency: 'RUB',
      income: '0.00',
      expense: '2500.60',
    });
    expect(series.find((p) => p.currency === 'RUB' && p.date === '2026-10-03')?.expense).toBe(
      '0.00',
    );
  });
});

describe('buildMonthlyTrend', () => {
  it('aggregates per month and fills empty months', () => {
    const trend = buildMonthlyTrend(rows, ['2026-08', '2026-09', '2026-10']);
    const rub = trend.filter((p) => p.currency === 'RUB');
    expect(rub.map((p) => [p.month, p.income, p.expense])).toEqual([
      ['2026-08', '0.00', '0.00'],
      ['2026-09', '0.00', '700.00'],
      ['2026-10', '100000.00', '2500.60'],
    ]);
  });
});

describe('buildCategorySpending', () => {
  it('computes shares within each currency', () => {
    const categories = new Map([
      ['food', { name: 'Продукты', color: '#f00', systemKey: 'groceries' }],
      ['cafe', { name: 'Кафе', color: '#0f0', systemKey: null }],
    ]);
    const result = buildCategorySpending(
      [
        { categoryId: 'cafe', currency: 'RUB', amount: d('250') },
        { categoryId: 'food', currency: 'RUB', amount: d('750') },
        { categoryId: 'cafe', currency: 'USD', amount: d('10') },
      ],
      categories,
    );
    expect(result.map((r) => [r.currency, r.name, r.amount, r.share])).toEqual([
      ['RUB', 'Продукты', '750.00', 0.75],
      ['RUB', 'Кафе', '250.00', 0.25],
      ['USD', 'Кафе', '10.00', 1],
    ]);
  });
});

describe('account balances', () => {
  it('applies income, expense and transfers in both directions', () => {
    const flows = collectAccountFlows(
      [
        { accountId: 'card', type: 'INCOME', amount: d('1000') },
        { accountId: 'card', type: 'EXPENSE', amount: d('200.25') },
        { accountId: 'card', type: 'TRANSFER', amount: d('300') },
      ],
      [{ toAccountId: 'savings', amount: d('300') }],
    );
    expect(computeBalance(d('50'), flows.get('card')!)).toBe(d('549.75'));
    expect(computeBalance(0n, flows.get('savings')!)).toBe(d('300'));
  });

  it('keeps the total unchanged after an internal transfer in one currency', () => {
    const flows = collectAccountFlows(
      [{ accountId: 'a', type: 'TRANSFER', amount: d('400') }],
      [{ toAccountId: 'b', amount: d('400') }],
    );
    const totals = sumBalancesByCurrency([
      { currency: 'RUB', balance: computeBalance(d('1000'), flows.get('a')!) },
      { currency: 'RUB', balance: computeBalance(0n, flows.get('b')!) },
    ]);
    expect(totals).toEqual([{ currency: 'RUB', total: '1000.00' }]);
  });

  it('never sums different currencies', () => {
    expect(
      sumBalancesByCurrency([
        { currency: 'USD', balance: d('10') },
        { currency: 'RUB', balance: d('1000') },
        { currency: 'USD', balance: d('5.5') },
      ]),
    ).toEqual([
      { currency: 'RUB', total: '1000.00' },
      { currency: 'USD', total: '15.50' },
    ]);
  });
});

describe('budgetProgress', () => {
  it('reports overspending as negative remaining', () => {
    expect(budgetProgress(d('1000'), d('1250'))).toEqual({ remaining: '-250.00', progress: 1.25 });
  });

  it('reports partial usage', () => {
    expect(budgetProgress(d('3000'), d('1000'))).toEqual({
      remaining: '2000.00',
      progress: 0.3333,
    });
  });
});
