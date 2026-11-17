import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatCompactNumber,
  formatMoney,
  formatMonth,
  formatNumber,
  formatTimestamp,
} from './format';

const normalize = (value: string) => value.replace(/\s/g, ' ');

describe('formatMoney', () => {
  it('formats a decimal string with the currency', () => {
    expect(normalize(formatMoney('1500.5', 'RUB'))).toBe('1 500,50 ₽');
  });

  it('uses a real minus sign for negative values', () => {
    expect(normalize(formatMoney('-20', 'USD'))).toBe('−20,00 $');
  });

  it('adds a plus sign only when requested', () => {
    expect(normalize(formatMoney('10', 'EUR', { signed: true }))).toBe('+10,00 €');
    expect(normalize(formatMoney('0', 'EUR', { signed: true }))).toBe('0,00 €');
  });

  it('falls back gracefully for unknown currency codes', () => {
    expect(() => formatMoney('1', 'XXZ')).not.toThrow();
  });
});

describe('formatMonth', () => {
  it('renders a capitalized month name in Russian', () => {
    expect(formatMonth('2026-10')).toBe('Октябрь 2026');
  });
});

describe('formatCompactNumber', () => {
  it('shortens large axis values without a currency', () => {
    expect(normalize(formatCompactNumber(12_300))).toBe('12,3 тыс.');
    expect(formatCompactNumber(950)).toBe('950');
  });
});

describe('formatTimestamp', () => {
  it('names the month and keeps the time', () => {
    expect(normalize(formatTimestamp('2026-10-28T14:30:00'))).toBe('28 окт. 2026 г., 14:30');
  });
});

describe('formatAmount', () => {
  it('always shows two decimals without a currency', () => {
    expect(normalize(formatAmount('1234.5'))).toBe('1 234,50');
    expect(normalize(formatAmount('-0.07'))).toBe('-0,07');
  });
});

describe('formatNumber', () => {
  it('groups digits', () => {
    expect(normalize(formatNumber(12345))).toBe('12 345');
  });
});
