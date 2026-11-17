import { describe, expect, it } from 'vitest';
import {
  capitalShare,
  FULL_SHARE,
  hasMoney,
  hundredthsToPercent,
  planFactBar,
  planFactDiff,
  reservedTotal,
  shareHundredths,
  sharesTotal,
} from './model';

describe('shares', () => {
  it('accepts 49.9 + 49.8 + 0.3 as exactly 100% (floats give 99.99999999999999)', () => {
    expect(49.9 + 49.8 + 0.3).not.toBe(100);
    expect(sharesTotal(['49.9', '49,8', '0.3'])).toBe(FULL_SHARE);
  });

  it('reads typed percentages in hundredths', () => {
    expect(shareHundredths('50')).toBe(5000);
    expect(shareHundredths(' 33,33 ')).toBe(3333);
    expect(shareHundredths('.5')).toBe(50);
    expect(shareHundredths('12.345')).toBe(1235);
    expect(shareHundredths('-5')).toBe(-500);
  });

  it('counts empty and non-numeric fields as zero', () => {
    expect(shareHundredths('')).toBe(0);
    expect(shareHundredths(undefined)).toBe(0);
    expect(shareHundredths('abc')).toBe(0);
    expect(shareHundredths('.')).toBe(0);
    expect(sharesTotal(['60', '', 'x', '40'])).toBe(FULL_SHARE);
  });

  it('shows the total as a percentage', () => {
    expect(hundredthsToPercent(sharesTotal(['33.33', '33.33', '33.33']))).toBe(99.99);
    expect(hundredthsToPercent(FULL_SHARE)).toBe(100);
  });
});

describe('wealth', () => {
  it('adds reserved and outside money exactly', () => {
    expect(reservedTotal('100.10', '0.20')).toBe('100.30');
  });

  it('gives a member a non-negative share of the capital', () => {
    expect(capitalShare('250', '1000')).toBe(25);
    expect(capitalShare('-10', '1000')).toBe(0);
  });

  it('keeps members with own or reserved money', () => {
    expect(hasMoney({ total: '0.00', reserved: '0.00' })).toBe(false);
    expect(hasMoney({ total: '0.00', reserved: '5.00' })).toBe(true);
    expect(hasMoney({ total: '-1', reserved: '0' })).toBe(true);
  });
});

describe('plan against fact', () => {
  it('scales both bars to the larger value', () => {
    expect(planFactBar('200', '100')).toEqual({ planWidth: 100, factWidth: 50, over: false });
    expect(planFactBar('100', '150')).toEqual({
      planWidth: (100 / 150) * 100,
      factWidth: 100,
      over: true,
    });
  });

  it('uses at least 1 as the scale and no overspending without a plan', () => {
    expect(planFactBar('0', '0')).toEqual({ planWidth: 0, factWidth: 0, over: false });
    expect(planFactBar('0', '0.50')).toEqual({ planWidth: 0, factWidth: 50, over: false });
  });

  it('subtracts fact from plan in cents', () => {
    expect(planFactDiff('100.30', '100.10')).toBe('0.20');
    expect(planFactDiff('10', '12.5')).toBe('-2.50');
  });
});
