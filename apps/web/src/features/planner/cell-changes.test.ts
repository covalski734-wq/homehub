import type { DeductionDto, PurchaseDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import {
  deductionChanges,
  deductionDraftInput,
  incomeChanges,
  incomeDraftInput,
  purchaseChanges,
  purchaseCompletion,
  purchaseDraftInput,
  recurringChanges,
  recurringDraftInput,
  recurringKind,
} from './cell-changes';

// The conversions the planner tables sent before the typed version, pinned per column.

describe('regular expense cells', () => {
  it('converts each column to its API field', () => {
    expect(recurringChanges('name', 'Аренда')).toEqual({ name: 'Аренда' });
    expect(recurringChanges('category', 'FOOD')).toEqual({ category: 'FOOD' });
    expect(recurringChanges('currency', 'EUR')).toEqual({ currency: 'EUR' });
    expect(recurringChanges('intervalMonths', '3')).toEqual({ intervalMonths: 3 });
    expect(recurringChanges('dueDay', '')).toEqual({ dueDay: null });
    expect(recurringChanges('dueDay', '15')).toEqual({ dueDay: 15 });
    expect(recurringChanges('ongoingEndDay', '')).toEqual({ ongoingEndDay: null });
    expect(recurringChanges('endMonth', '')).toEqual({ endMonth: null });
    expect(recurringChanges('endMonth', '2026-12')).toEqual({ endMonth: '2026-12' });
    expect(recurringChanges('ownerId', '')).toEqual({ ownerId: null });
    expect(recurringChanges('isRequired', 'false')).toEqual({ isRequired: false });
    expect(recurringChanges('kind', 'LOAN')).toEqual({ isOngoing: false, isLoan: true });
    expect(recurringChanges('kind', 'ONGOING')).toEqual({ isOngoing: true, isLoan: false });
    expect(recurringChanges('loanTotal', '1 200,50')).toEqual({ loanTotal: '1200.50' });
    expect(recurringChanges('loanTotal', '')).toEqual({ loanTotal: null });
  });

  it('rejects a select value outside the enum and read-only columns', () => {
    expect(() => recurringChanges('category', 'PETS')).toThrow();
    expect(() => recurringChanges('base', '1')).toThrow();
  });

  it('builds a new line from the draft', () => {
    const draft = {
      name: 'Netflix',
      isRequired: 'false',
      kind: 'ONCE',
      duration: 'FORWARD',
      category: 'SUBSCRIPTIONS',
      amount: '49,99',
      currency: 'PLN',
      intervalMonths: '1',
      dueDay: '',
      startMonth: '2026-11',
      endMonth: '',
    };
    expect(recurringDraftInput(draft)).toEqual({
      name: 'Netflix',
      isRequired: false,
      isOngoing: false,
      isLoan: false,
      category: 'SUBSCRIPTIONS',
      currency: 'PLN',
      amount: '49.99',
      intervalMonths: 1,
      dueDay: null,
      startMonth: '2026-11',
      endMonth: null,
    });
    expect(recurringDraftInput({ ...draft, duration: 'MONTH', dueDay: '5' })).toMatchObject({
      dueDay: 5,
      endMonth: '2026-11',
    });
  });

  it('names the type select value', () => {
    expect(recurringKind({ isLoan: true, isOngoing: true })).toBe('LOAN');
    expect(recurringKind({ isLoan: false, isOngoing: true })).toBe('ONGOING');
    expect(recurringKind({ isLoan: false, isOngoing: false })).toBe('ONCE');
  });
});

describe('income cells', () => {
  it('converts each column to its API field', () => {
    expect(incomeChanges('kind', 'BUSINESS')).toEqual({ kind: 'BUSINESS' });
    expect(incomeChanges('endMonth', '')).toEqual({ endMonth: null });
    expect(incomeChanges('ownerId', 'm1')).toEqual({ ownerId: 'm1' });
    expect(() => incomeChanges('net', '1')).toThrow();
  });

  it('builds a new income from the draft', () => {
    expect(
      incomeDraftInput({
        name: 'Зарплата',
        kind: 'SALARY',
        gross: '10 000',
        currency: 'PLN',
        startMonth: '2026-11',
        endMonth: '',
        duration: 'MONTH',
      }),
    ).toEqual({
      name: 'Зарплата',
      kind: 'SALARY',
      currency: 'PLN',
      amount: '10000',
      startMonth: '2026-11',
      endMonth: '2026-11',
    });
  });
});

describe('deduction cells', () => {
  const percent: DeductionDto = {
    id: 'd1',
    name: 'ZUS',
    kind: 'PERCENT',
    rate: '19.52',
    base: 'GROSS',
    amount: null,
    currency: 'PLN',
    startMonth: null,
    endMonth: null,
    version: 1,
    active: true,
    monthAmount: '100.00',
  };

  it('edits the rate of a percentage and the amount of a fixed deduction', () => {
    expect(deductionChanges(percent, 'value', '20,5', 'PLN')).toEqual({ rate: '20.5' });
    expect(
      deductionChanges({ ...percent, kind: 'FIXED', amount: '50.00' }, 'value', '60', 'PLN'),
    ).toEqual({ amount: '60' });
  });

  it('keeps the number when the type changes', () => {
    expect(deductionChanges(percent, 'kind', 'FIXED', 'PLN')).toEqual({
      kind: 'FIXED',
      base: 'GROSS',
      amount: '19.52',
    });
    expect(deductionChanges(percent, 'kind', 'REMAINDER', 'PLN')).toEqual({
      kind: 'PERCENT',
      base: 'REMAINDER',
      rate: '19.52',
    });
  });

  it('stores the income currency as none', () => {
    expect(deductionChanges(percent, 'currency', 'PLN', 'PLN')).toEqual({ currency: null });
    expect(deductionChanges(percent, 'currency', 'EUR', 'PLN')).toEqual({ currency: 'EUR' });
    expect(deductionChanges(percent, 'endMonth', '', 'PLN')).toEqual({ endMonth: null });
  });

  it('builds a new deduction from the draft', () => {
    const draft = {
      name: 'Налог',
      kind: 'PERCENT',
      value: '12',
      currency: 'PLN',
      startMonth: '',
      endMonth: '',
    };
    expect(deductionDraftInput(draft, 'PLN')).toEqual({
      name: 'Налог',
      kind: 'PERCENT',
      base: 'GROSS',
      rate: '12',
      amount: null,
      currency: null,
      startMonth: null,
      endMonth: null,
    });
    expect(deductionDraftInput({ ...draft, kind: 'FIXED', currency: 'EUR' }, 'PLN')).toMatchObject({
      kind: 'FIXED',
      rate: null,
      amount: '12',
      currency: 'EUR',
    });
  });
});

describe('purchase cells', () => {
  const bought: PurchaseDto = {
    id: 'p1',
    title: 'Пылесос',
    ownerId: null,
    shares: null,
    actual: null,
    category: 'HOME',
    priority: 'MEDIUM',
    currency: 'PLN',
    estimatedAmount: '300.00',
    plannedMonth: '2026-10',
    status: 'PURCHASED',
    purchasedOn: '2026-10-05',
    actualAmount: null,
    note: '',
    version: 1,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    budgetMonth: '2026-10',
    budgetAmount: '300.00',
  };

  it('converts plain edits', () => {
    expect(purchaseChanges('priority', 'HIGH')).toEqual({ priority: 'HIGH' });
    expect(purchaseChanges('estimatedAmount', '1 000,5')).toEqual({ estimatedAmount: '1000.5' });
    expect(purchaseChanges('plannedMonth', '')).toEqual({ plannedMonth: null });
  });

  it('changes the date or the price of a bought purchase, keeping the other', () => {
    expect(purchaseCompletion(bought, 'actualAmount', '280')).toEqual({
      purchasedOn: '2026-10-05',
      actualAmount: '280',
    });
    expect(purchaseCompletion(bought, 'purchasedOn', '')).toEqual({
      purchasedOn: null,
      actualAmount: '300.00',
    });
  });

  it('builds a new purchase from the draft', () => {
    expect(
      purchaseDraftInput({
        title: 'Пылесос',
        category: 'HOME',
        priority: 'MEDIUM',
        estimatedAmount: '999',
        currency: 'PLN',
        plannedMonth: '',
      }),
    ).toEqual({
      title: 'Пылесос',
      category: 'HOME',
      priority: 'MEDIUM',
      currency: 'PLN',
      estimatedAmount: '999',
      plannedMonth: null,
    });
  });
});
