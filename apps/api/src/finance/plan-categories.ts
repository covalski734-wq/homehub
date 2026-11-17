import type { PlanFactKey } from '@homehub/shared';

/**
 * How planned lines map to finance categories and back: the finance category of the operation that
 * is the fact of a planned line, and the planner category an operation entered by hand counts in.
 */

/** Finance category of a planned line's operation (the planner category stays on the operation). */
const EXPENSE_CATEGORY: Record<string, string> = {
  HOUSING: 'housing',
  UTILITIES: 'housing',
  FOOD: 'groceries',
  SUBSCRIPTIONS: 'subscriptions',
  COMMUNICATION: 'subscriptions',
  EDUCATION: 'education',
  TRANSPORT: 'transport',
  HEALTH: 'health',
};
const PURCHASE_CATEGORY: Record<string, string> = {
  TRAVEL: 'travel',
  HEALTH: 'health',
  EDUCATION: 'education',
  TRANSPORT: 'transport',
};
const INCOME_CATEGORY: Record<string, string> = { SALARY: 'salary', BUSINESS: 'freelance' };

/** Planner category of an operation entered by hand, from its finance category. */
const PLAN_OF_CATEGORY: Record<string, PlanFactKey> = {
  housing: 'HOUSING',
  groceries: 'FOOD',
  cafe: 'FOOD',
  transport: 'TRANSPORT',
  health: 'HEALTH',
  subscriptions: 'SUBSCRIPTIONS',
  education: 'EDUCATION',
};

export const financeKeyForExpense = (category: string) =>
  EXPENSE_CATEGORY[category] ?? 'other-expense';
export const financeKeyForPurchase = (category: string) =>
  PURCHASE_CATEGORY[category] ?? 'shopping';
export const financeKeyForIncome = (kind: string) => INCOME_CATEGORY[kind] ?? 'other-income';
export const planKeyOfCategory = (systemKey: string | null): PlanFactKey =>
  (systemKey && PLAN_OF_CATEGORY[systemKey]) || 'OTHER';
