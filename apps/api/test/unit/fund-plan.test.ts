import { describe, expect, it } from 'vitest';
import {
  planFunds,
  type FundPart,
  type FundPlanInput,
  type FundPlanContext,
} from '../../src/planner/fund-plan';

const part: FundPart = {
  subaccountId: 'a',
  potId: 'fund',
  potName: 'Fund',
  potPriority: 0,
  name: 'Part',
  ownerId: null,
  color: null,
  currency: 'PLN',
  rule: null,
};
const ctx: FundPlanContext = {
  month: '2026-11',
  base: 'PLN',
  rates: new Map(),
  netIncome: 1000000n,
  netByOwner: new Map(),
  freeBeforeSavings: 400000n,
};
const input = (over: Partial<FundPlanInput> = {}): FundPlanInput => ({
  parts: [part],
  overrides: new Map(),
  deposits: new Map(),
  minFreeMinor: 0,
  remainderMode: true,
  ...over,
});

describe('money already assigned to savings', () => {
  it('keeps the unassigned remainder when no money has been deposited', () => {
    expect(planFunds(input(), ctx)).toMatchObject({
      total: '4000.00',
      unallocated: '4000.00',
      deficit: '0.00',
    });
  });
  it('counts a deposit without a rule and keeps it after a new purchase causes a deficit', () => {
    const funds = input({ deposits: new Map([['a:2026-11', 300000]]) });
    expect(planFunds(funds, ctx)).toMatchObject({
      total: '4000.00',
      unallocated: '1000.00',
      lines: [{ planned: '3000.00', deposited: '3000.00' }],
    });
    expect(planFunds(funds, { ...ctx, freeBeforeSavings: 200000n })).toMatchObject({
      total: '3000.00',
      unallocated: '0.00',
      deficit: '1000.00',
    });
  });
  it('does not count an explicit plan and its deposit twice or use another month', () => {
    expect(
      planFunds(
        input({
          remainderMode: false,
          overrides: new Map([['a:2026-11', 300000]]),
          deposits: new Map([
            ['a:2026-11', 200000],
            ['a:2026-10', 900000],
          ]),
        }),
        ctx,
      ),
    ).toMatchObject({ total: '3000.00' });
    expect(
      planFunds(input({ remainderMode: false, deposits: new Map([['a:2026-10', 900000]]) }), ctx),
    ).toBeNull();
  });
  it('retains deposits above an explicit zero plan', () => {
    expect(
      planFunds(
        input({
          remainderMode: false,
          overrides: new Map([['a:2026-11', 0]]),
          deposits: new Map([['a:2026-11', 500000]]),
        }),
        ctx,
      ),
    ).toMatchObject({ total: '5000.00', deficit: '1000.00' });
  });
  it('releases withdrawn money while preserving the gross deposit shown in history', () => {
    const plan = planFunds(
      input({
        remainderMode: false,
        deposits: new Map([['a:2026-11', 500000]]),
        netDeposits: new Map([['a:2026-11', 200000]]),
      }),
      ctx,
    )!;
    expect(plan).toMatchObject({
      total: '2000.00',
      lines: [{ deposited: '5000.00', planned: '2000.00' }],
    });
  });
  it('reserves all remainder deposits before allocating the remaining pool', () => {
    const rule = {
      mode: 'REMAINDER' as const,
      amountMinor: null,
      percentBp: null,
      percentBase: null,
      minMinor: null,
      maxMinor: null,
      priority: 0,
      startMonth: '2026-01',
      endMonth: null,
    };
    const funds = input({
      parts: [
        { ...part, rule },
        { ...part, subaccountId: 'b', rule },
      ],
      deposits: new Map([['b:2026-11', 300000]]),
    });
    const plan = planFunds(funds, ctx)!;
    expect(plan.total).toBe('4000.00');
    expect(plan.lines.map((line) => line.planned)).toEqual(['1000.00', '3000.00']);
    expect(planFunds(funds, { ...ctx, freeBeforeSavings: 200000n })).toMatchObject({
      total: '3000.00',
      deficit: '1000.00',
    });
  });
});
