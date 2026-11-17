import type { MovementDto, PotDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import {
  addMoney,
  changeView,
  historyByMonth,
  investmentsTotal,
  isLowBalance,
  moneySign,
  partWidth,
  percentOf,
  positionValue,
  sameMoney,
  subtractMoney,
} from './model';

describe('money sums', () => {
  it('adds exactly where floats drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('1000.05', null, undefined, '-0.05')).toBe('1000.00');
    expect(addMoney()).toBe('0.00');
  });

  it('subtracts deposits and withdrawals of a month', () => {
    expect(subtractMoney('300.10', '300.30')).toBe('-0.20');
    expect(subtractMoney('1500', '0')).toBe('1500.00');
  });

  it('compares and signs amounts in cents', () => {
    expect(moneySign('0.00')).toBe(0);
    expect(moneySign('-0.01')).toBe(-1);
    expect(moneySign('12')).toBe(1);
    expect(sameMoney('10', '10.00')).toBe(true);
    expect(sameMoney('10.01', '10.00')).toBe(false);
  });
});

describe('shares and bars', () => {
  it('gives a percentage of a positive whole', () => {
    expect(percentOf('25', '100')).toBe(25);
    expect(percentOf('1', 300n)).toBeCloseTo((1 / 3) * 100);
    expect(percentOf('5', '0')).toBe(0);
  });

  it('measures a fund part against the larger of balance and target', () => {
    expect(partWidth('50', '100', null)).toBe(50);
    expect(partWidth('50', '100', '200')).toBe(25);
    expect(partWidth('50', '100', '80')).toBe(50);
  });
});

describe('portfolio', () => {
  it('treats positions under one unit as low balance', () => {
    expect(isLowBalance(null)).toBe(false);
    expect(isLowBalance('0.99')).toBe(true);
    expect(isLowBalance('1.00')).toBe(false);
  });

  it('shows changes under a cent as «<0,01»', () => {
    expect(changeView('0.004')).toEqual({ sign: 1, tiny: true });
    expect(changeView('-0.004')).toEqual({ sign: -1, tiny: true });
    expect(changeView('0.00')).toEqual({ sign: 0, tiny: false });
    expect(changeView('-2.50')).toEqual({ sign: -1, tiny: false });
  });

  it('totals active portfolios and shows a dash when nothing has a rate', () => {
    const pot = (value: string | null, archived = false) => ({ value, archived }) as PotDto;
    expect(investmentsTotal([pot('10.10'), pot('0.20'), pot('99', true)])).toEqual({
      total: '10.30',
      empty: false,
    });
    expect(investmentsTotal([pot(null)])).toEqual({ total: '0.00', empty: true });
    expect(investmentsTotal([pot(null), pot('5')])).toEqual({ total: '5.00', empty: false });
  });

  it('previews quantity × price rounded to cents', () => {
    expect(positionValue('0.5', '64000.1')).toBe('32000.05');
    expect(positionValue('0,00012345', '250000')).toBe('30.86');
    expect(positionValue('3', '0.1')).toBe('0.30');
    expect(positionValue('', '10')).toBe('0.00');
    expect(positionValue('abc', '10')).toBeNull();
    expect(positionValue('1', null)).toBeNull();
  });
});

describe('history', () => {
  it('groups movements by month with a net per month', () => {
    const move = (date: string, type: MovementDto['type'], amount: string) =>
      ({ id: date + amount, date, type, amount }) as MovementDto;
    expect(
      historyByMonth([
        move('2026-10-20', 'DEPOSIT', '100.10'),
        move('2026-10-02', 'WITHDRAWAL', '0.20'),
        move('2026-09-15', 'WITHDRAWAL', '50'),
      ]).map(({ month, net, items }) => ({ month, net, count: items.length })),
    ).toEqual([
      { month: '2026-10', net: '99.90', count: 2 },
      { month: '2026-09', net: '-50.00', count: 1 },
    ]);
  });
});
