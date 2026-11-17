import { describe, expect, it } from 'vitest';
import {
  centsToNumber,
  divRound,
  fromCents,
  rateToMicros,
  sumByCurrency,
  sumCents,
  toCents,
} from './money';

describe('money', () => {
  it('converts decimal strings to cents and back exactly', () => {
    expect(toCents('1234.5')).toBe(123450n);
    expect(toCents('-0.07')).toBe(-7n);
    expect(toCents('12')).toBe(1200n);
    expect(fromCents(-7n)).toBe('-0.07');
    expect(fromCents(123450n)).toBe('1234.50');
  });

  it('sums without float drift', () => {
    expect(sumCents(['0.1', '0.2'])).toBe(30n);
    expect(sumCents([])).toBe(0n);
    expect(
      sumByCurrency([
        { currency: 'USD', amount: '1.10' },
        { currency: 'EUR', amount: '2' },
        { currency: 'USD', amount: '2.20' },
      ]),
    ).toEqual([
      { currency: 'EUR', amount: '2.00' },
      { currency: 'USD', amount: '3.30' },
    ]);
  });

  it('rounds division half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(5n, -3n)).toBe(-2n);
    expect(() => divRound(1n, 0n)).toThrow(RangeError);
  });

  it('reads exchange rates as micro-units', () => {
    expect(rateToMicros('4.2615')).toBe(4_261_500n);
    expect(rateToMicros('1')).toBe(1_000_000n);
    expect(rateToMicros('0.123456')).toBe(123_456n);
    expect(rateToMicros('abc')).toBeNull();
  });

  it('turns cents into chart numbers', () => {
    expect(centsToNumber(-12345n)).toBe(-123.45);
  });
});
