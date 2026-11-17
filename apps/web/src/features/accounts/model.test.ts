import { describe, expect, it } from 'vitest';
import { reconcileDifference, totalsByCurrency } from './model';

describe('totalsByCurrency', () => {
  it('sums exactly in cents, per currency, in the order currencies first appear', () => {
    expect(
      totalsByCurrency([
        { currency: 'PLN', balance: '0.10' },
        { currency: 'EUR', balance: '5' },
        { currency: 'PLN', balance: '0.20' },
        { currency: 'PLN', balance: '-1.05' },
      ]),
    ).toEqual([
      // 0.1 + 0.2 is not 0.3 in floating point.
      { currency: 'PLN', sum: '-0.75' },
      { currency: 'EUR', sum: '5.00' },
    ]);
  });

  it('is empty for no accounts', () => {
    expect(totalsByCurrency([])).toEqual([]);
  });
});

describe('reconcileDifference', () => {
  it('is the typed balance minus the current one', () => {
    expect(reconcileDifference('1 250,30', '1000.10')).toBe('250.20');
    expect(reconcileDifference('-5', '10.00')).toBe('-15.00');
  });

  it('is null when nothing changes or the text is not an amount yet', () => {
    expect(reconcileDifference('1000.1', '1000.10')).toBeNull();
    expect(reconcileDifference('', '10.00')).toBeNull();
    expect(reconcileDifference('-', '10.00')).toBeNull();
    expect(reconcileDifference('12a', '10.00')).toBeNull();
  });
});
