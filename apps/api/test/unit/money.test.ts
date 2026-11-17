import { describe, expect, it } from 'vitest';
import { formatMinor, minorFromSql, ratio, toMinor, toMinorNumber } from '../../src/lib/money';

describe('money conversion', () => {
  it.each([
    ['1500', 150000n],
    ['1500.5', 150050n],
    ['0.01', 1n],
    ['-12.30', -1230n],
    ['999999999999.99', 99999999999999n],
  ])('parses %s exactly', (input, expected) => {
    expect(toMinor(input)).toBe(expected);
  });

  it.each(['1.234', 'abc', '', '1e5', '0x10'])('rejects %s', (input) => {
    expect(() => toMinor(input)).toThrow();
  });

  it.each([
    [150050n, '1500.50'],
    [1n, '0.01'],
    [-5n, '-0.05'],
    [0, '0.00'],
    [-123456, '-1234.56'],
  ])('formats %s', (input, expected) => {
    expect(formatMinor(input)).toBe(expected);
  });

  it('round-trips every cent value without floating point error', () => {
    for (let cents = 0; cents < 1000; cents += 1) {
      const text = formatMinor(cents);
      expect(toMinorNumber(text)).toBe(cents);
    }
  });

  it('reads SQL aggregates beyond the safe integer range exactly', () => {
    expect(minorFromSql('90071992547409930')).toBe(90071992547409930n);
    expect(formatMinor(minorFromSql('90071992547409930'))).toBe('900719925474099.30');
    expect(minorFromSql(null)).toBe(0n);
  });

  it('computes ratios with 4-digit precision', () => {
    expect(ratio(1n, 3n)).toBe(0.3333);
    expect(ratio(2n, 3n)).toBe(0.6667);
    expect(ratio(1250n, 1000n)).toBe(1.25);
    expect(ratio(5n, 0n)).toBe(0);
  });
});
