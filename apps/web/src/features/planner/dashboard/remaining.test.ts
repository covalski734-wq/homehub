import type { PurchaseDto, RecurringLineDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import { fromCents } from '@/lib/money';
import { remainingItems, summarizeRemaining, toBaseCents } from './remaining';

// Values below were taken from the previous floating-point version of the card (formatted to
// cents the way the UI shows them), so the exact-cents model must show the same numbers.

const line = (over: Partial<RecurringLineDto>): RecurringLineDto => ({
  id: 'r1',
  name: 'Аренда',
  ownerId: null,
  shares: null,
  actual: null,
  isFundReturn: false,
  isRequired: true,
  isOngoing: false,
  ongoingStartDay: null,
  ongoingEndDay: null,
  isLoan: false,
  loanTotal: null,
  paid: false,
  category: 'HOUSING',
  currency: 'PLN',
  intervalMonths: 1,
  startMonth: '2026-01',
  endMonth: null,
  dueDay: 10,
  note: '',
  version: 1,
  active: true,
  skipped: false,
  overridden: false,
  amount: '3000.00',
  base: '3000.00',
  ...over,
});

const purchase = (over: Partial<PurchaseDto>): PurchaseDto => ({
  id: 'p1',
  title: 'Пылесос',
  ownerId: null,
  shares: null,
  actual: null,
  category: 'HOME',
  priority: 'MEDIUM',
  currency: 'PLN',
  estimatedAmount: '100.00',
  plannedMonth: '2026-11',
  status: 'ACTIVE',
  purchasedOn: null,
  actualAmount: null,
  note: '',
  version: 1,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  budgetMonth: '2026-11',
  budgetAmount: '100.00',
  ...over,
});

const rates = [
  { currency: 'EUR' as const, rate: '4.2615', effectiveDate: '2026-10-30' },
  { currency: 'USD' as const, rate: '3.9871', effectiveDate: '2026-10-30' },
];

describe('toBaseCents', () => {
  it('keeps amounts already in the display currency', () => {
    expect(toBaseCents({ baseCurrency: 'PLN', rates }, '12.34', 'PLN')).toBe(1234n);
  });

  it('converts through PLN with one rounding, like the server', () => {
    // 49.99 EUR × 4.2615 = 213.032385 → 213.03 PLN
    expect(fromCents(toBaseCents({ baseCurrency: 'PLN', rates }, '49.99', 'EUR')!)).toBe('213.03');
    // 100 USD → EUR: 100 × 3.9871 / 4.2615 = 93.5609… → 93.56
    expect(fromCents(toBaseCents({ baseCurrency: 'EUR', rates }, '100', 'USD')!)).toBe('93.56');
    // PLN → EUR: 10 / 4.2615 = 2.3466… → 2.35
    expect(fromCents(toBaseCents({ baseCurrency: 'EUR', rates }, '10', 'PLN')!)).toBe('2.35');
  });

  it('is null without a rate', () => {
    expect(toBaseCents({ baseCurrency: 'PLN', rates: [] }, '10', 'CAD')).toBeNull();
  });
});

describe('remainingItems', () => {
  const now = new Date(2026, 10, 10); // 10 November 2026

  it('prorates an ongoing payment by the days that passed', () => {
    const [item] = remainingItems(
      {
        month: '2026-11',
        baseCurrency: 'PLN',
        rates,
        recurring: [line({ isOngoing: true, amount: '1000.00', base: '1000.00', dueDay: null })],
        purchases: [],
      },
      now,
    );
    // 10 of 30 days: 333.33 spent, 666.67 left (old: 1000 × 1/3 and 1000 × 2/3).
    expect(fromCents(item!.doneBase)).toBe('333.33');
    expect(fromCents(item!.leftBase)).toBe('666.67');
    expect(item!.done).toBe(false);
    expect(item!.dueDay).toBeNull();
    expect(item!.spent).toBeCloseTo(1 / 3);
  });

  it('counts a ticked payment as paid and a planned purchase as left, sorted by due day', () => {
    const items = remainingItems(
      {
        month: '2026-11',
        baseCurrency: 'PLN',
        rates,
        recurring: [
          line({ id: 'a', name: 'Интернет', dueDay: 20, amount: '60.00', base: '60.00' }),
          line({ id: 'b', paid: true }),
          line({ id: 'c', active: false }),
        ],
        purchases: [
          purchase({ currency: 'EUR', budgetAmount: '49.99' }),
          purchase({ id: 'p2', status: 'CANCELLED' }),
        ],
      },
      now,
    );
    expect(items.map((i) => i.key)).toEqual(['r:b', 'r:a', 'p:p1']);
    const summary = summarizeRemaining(items, () => false);
    expect(fromCents(summary.leftSum)).toBe('273.03');
    expect(fromCents(summary.doneSum)).toBe('3000.00');
    expect(fromCents(summary.total)).toBe('3273.03');
    expect(summary.left.map((i) => i.key)).toEqual(['r:a', 'p:p1']);
    expect(summary.noRate).toBe(false);
  });

  it('leaves out switched-off items and reports missing rates', () => {
    const items = remainingItems(
      {
        month: '2026-11',
        baseCurrency: 'PLN',
        rates: [],
        recurring: [line({})],
        purchases: [purchase({ currency: 'CAD' })],
      },
      now,
    );
    const summary = summarizeRemaining(items, (i) => i.group === 'required');
    expect(summary.off.map((i) => i.key)).toEqual(['r:r1']);
    expect(summary.leftSum).toBe(0n);
    expect(summary.noRate).toBe(true);
  });
});
