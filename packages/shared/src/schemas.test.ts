import { describe, expect, it } from 'vitest';
import { moneySchema, transactionInputSchema } from './schemas';
import { daysInMonth, isValidDate, monthDateRange, shiftMonth } from './month';

const accountA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const accountB = '9b2f3c1a-1d4e-4f5a-8b6c-7d8e9f0a1b2c';
const category = '1f0e2d3c-4b5a-4968-8776-655443322110';

describe('moneySchema', () => {
  it.each([
    ['1500', '1500'],
    ['12,5', '12.5'],
    [' 1 000.10 ', '1000.10'],
  ])('normalizes %s', (input, expected) => {
    expect(moneySchema.parse(input)).toBe(expected);
  });

  it.each(['0', '-5', '1.234', 'abc', '', '1e5'])('rejects %s', (input) => {
    expect(moneySchema.safeParse(input).success).toBe(false);
  });
});

describe('transactionInputSchema', () => {
  const base = { accountId: accountA, amount: '100', occurredAt: '2026-10-08' };

  it('requires a category for expenses', () => {
    const result = transactionInputSchema.safeParse({ ...base, type: 'EXPENSE' });
    expect(result.success).toBe(false);
  });

  it('accepts an expense with a category and normalizes empty ids', () => {
    const result = transactionInputSchema.parse({
      ...base,
      type: 'EXPENSE',
      categoryId: category,
      toAccountId: '',
    });
    expect(result.toAccountId).toBeNull();
    expect(result.description).toBe('');
  });

  it('rejects transfers to the same account', () => {
    const result = transactionInputSchema.safeParse({
      ...base,
      type: 'TRANSFER',
      toAccountId: accountA,
    });
    expect(result.success).toBe(false);
  });

  it('rejects categories on transfers', () => {
    const result = transactionInputSchema.safeParse({
      ...base,
      type: 'TRANSFER',
      toAccountId: accountB,
      categoryId: category,
    });
    expect(result.success).toBe(false);
  });

  it('rejects impossible dates', () => {
    const result = transactionInputSchema.safeParse({
      ...base,
      type: 'EXPENSE',
      categoryId: category,
      occurredAt: '2026-02-30',
    });
    expect(result.success).toBe(false);
  });
});

describe('month helpers', () => {
  it('shifts across year boundaries', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-10', -12)).toBe('2025-10');
  });

  it('builds a half-open month range', () => {
    const { start, end } = monthDateRange('2024-02');
    expect(start.toISOString()).toBe('2024-02-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2024-03-01T00:00:00.000Z');
    expect(daysInMonth('2024-02')).toBe(29);
  });

  it('validates calendar dates', () => {
    expect(isValidDate('2024-02-29')).toBe(true);
    expect(isValidDate('2025-02-29')).toBe(false);
  });
});
