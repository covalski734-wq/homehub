import {
  INCOME_KINDS,
  PLANNER_CURRENCIES,
  PURCHASE_CATEGORIES,
  PURCHASE_PRIORITIES,
  RECURRING_CATEGORIES,
  type DeductionCreateInput,
  type DeductionDto,
  type DeductionUpdateInput,
  type IncomeCreateInput,
  type IncomeLineDto,
  type IncomeUpdateInput,
  type PlannerCurrency,
  type PurchaseCreateInput,
  type PurchaseDto,
  type PurchaseUpdateInput,
  type RecurringCreateInput,
  type RecurringLineDto,
  type RecurringUpdateInput,
} from '@homehub/shared';
import type { ColumnKey } from '@/components/editable-table/editable-table';
import { optionValue } from '@/components/editable-table/options';
import { normalizeAmount } from '@/components/editable-table/validators';

/**
 * Text of an edited planner cell → the typed API change. Select cells are read back through the
 * shared enums (no casts), empty optional cells become null. Each table lists its computed
 * columns, so a column key that the row does not have is a compile error.
 */

type Changes<T> = Omit<T, 'version'>;

const optionalNumber = (text: string) => (text === '' ? null : Number(text));
const notEditable = (key: string) => new Error(`Column ${key} is not editable`);

/** «One month» drafts end in their start month; «from this month» ones run until `endMonth`. */
const draftEnd = (v: { duration: string; startMonth: string; endMonth: string }) =>
  v.duration === 'MONTH' ? v.startMonth : v.endMonth || null;

// ---- regular expenses ------------------------------------------------------------------------

export type RecurringColumn = ColumnKey<RecurringLineDto, 'kind' | 'duration'>;

/** The «type» select combines two flags. */
export const recurringKind = (r: Pick<RecurringLineDto, 'isLoan' | 'isOngoing'>) =>
  r.isLoan ? 'LOAN' : r.isOngoing ? 'ONGOING' : 'ONCE';

/** Every editable column except the amount, which has its own month-scoped endpoint. */
export function recurringChanges(
  key: RecurringColumn,
  text: string,
): Changes<RecurringUpdateInput> {
  switch (key) {
    case 'name':
      return { name: text };
    case 'category':
      return { category: optionValue(RECURRING_CATEGORIES, text) };
    case 'currency':
      return { currency: optionValue(PLANNER_CURRENCIES, text) };
    case 'intervalMonths':
      return { intervalMonths: Number(text) };
    case 'dueDay':
      return { dueDay: optionalNumber(text) };
    case 'ongoingStartDay':
      return { ongoingStartDay: optionalNumber(text) };
    case 'ongoingEndDay':
      return { ongoingEndDay: optionalNumber(text) };
    case 'startMonth':
      return { startMonth: text };
    case 'endMonth':
      return { endMonth: text === '' ? null : text };
    case 'ownerId':
      return { ownerId: text || null };
    case 'isRequired':
      return { isRequired: text === 'true' };
    case 'kind':
      return { isOngoing: text === 'ONGOING', isLoan: text === 'LOAN' };
    case 'loanTotal':
      return { loanTotal: text === '' ? null : normalizeAmount(text) };
    default:
      throw notEditable(key);
  }
}

export type RecurringDraftKey =
  | 'name'
  | 'isRequired'
  | 'kind'
  | 'duration'
  | 'category'
  | 'amount'
  | 'currency'
  | 'intervalMonths'
  | 'dueDay'
  | 'startMonth'
  | 'endMonth';

export function recurringDraftInput(v: Record<RecurringDraftKey, string>): RecurringCreateInput {
  return {
    name: v.name,
    isRequired: v.isRequired === 'true',
    isOngoing: v.kind === 'ONGOING',
    isLoan: v.kind === 'LOAN',
    category: optionValue(RECURRING_CATEGORIES, v.category),
    currency: optionValue(PLANNER_CURRENCIES, v.currency),
    amount: normalizeAmount(v.amount),
    intervalMonths: Number(v.intervalMonths),
    dueDay: v.dueDay ? Number(v.dueDay) : null,
    startMonth: v.startMonth,
    endMonth: draftEnd(v),
  };
}

/** The same line again (undo of a delete). */
export const recurringCopy = (r: RecurringLineDto): RecurringCreateInput => ({
  name: r.name,
  isRequired: r.isRequired,
  isOngoing: r.isOngoing,
  ongoingStartDay: r.ongoingStartDay,
  ongoingEndDay: r.ongoingEndDay,
  isLoan: r.isLoan,
  loanTotal: r.loanTotal,
  category: r.category,
  currency: r.currency,
  amount: r.amount,
  intervalMonths: r.intervalMonths,
  startMonth: r.startMonth,
  endMonth: r.endMonth,
  dueDay: r.dueDay,
  note: r.note,
});

// ---- incomes ---------------------------------------------------------------------------------

export type IncomeColumn = ColumnKey<IncomeLineDto, 'duration'>;

/** Every editable column except the gross amount (month-scoped endpoint). */
export function incomeChanges(key: IncomeColumn, text: string): Changes<IncomeUpdateInput> {
  switch (key) {
    case 'name':
      return { name: text };
    case 'kind':
      return { kind: optionValue(INCOME_KINDS, text) };
    case 'currency':
      return { currency: optionValue(PLANNER_CURRENCIES, text) };
    case 'startMonth':
      return { startMonth: text };
    case 'endMonth':
      return { endMonth: text === '' ? null : text };
    case 'ownerId':
      return { ownerId: text || null };
    default:
      throw notEditable(key);
  }
}

export type IncomeDraftKey =
  'name' | 'kind' | 'gross' | 'currency' | 'startMonth' | 'endMonth' | 'duration';

export function incomeDraftInput(v: Record<IncomeDraftKey, string>): IncomeCreateInput {
  return {
    name: v.name,
    kind: optionValue(INCOME_KINDS, v.kind),
    currency: optionValue(PLANNER_CURRENCIES, v.currency),
    amount: normalizeAmount(v.gross),
    startMonth: v.startMonth,
    endMonth: draftEnd(v),
  };
}

// ---- deductions ------------------------------------------------------------------------------

/** `value` is the rate of a percentage or the amount of a fixed deduction. */
export type DeductionColumn = ColumnKey<DeductionDto, 'value'>;

/** The type select combines kind and base: a percentage of gross or of the remainder. */
export type DeductionType = 'PERCENT' | 'REMAINDER' | 'FIXED';

export const deductionType = (d: Pick<DeductionDto, 'kind' | 'base'>): DeductionType =>
  d.kind === 'FIXED' ? 'FIXED' : d.base === 'REMAINDER' ? 'REMAINDER' : 'PERCENT';

export const typeFields = (type: string) =>
  type === 'FIXED'
    ? ({ kind: 'FIXED', base: 'GROSS' } as const)
    : ({ kind: 'PERCENT', base: type === 'REMAINDER' ? 'REMAINDER' : 'GROSS' } as const);

/** A fixed amount in the income's own currency is stored without a currency (null). */
const ownCurrency = (text: string, incomeCurrency: PlannerCurrency) =>
  text === incomeCurrency ? null : optionValue(PLANNER_CURRENCIES, text);

export function deductionChanges(
  d: DeductionDto,
  key: DeductionColumn,
  text: string,
  incomeCurrency: PlannerCurrency,
): Changes<DeductionUpdateInput> {
  switch (key) {
    case 'value': {
      const normalized = normalizeAmount(text);
      return d.kind === 'PERCENT' ? { rate: normalized } : { amount: normalized };
    }
    case 'kind': {
      // Switching the type needs a value of the new type; keep the current number.
      const current = (d.kind === 'PERCENT' ? d.rate : d.amount) ?? '0';
      const fields = typeFields(text);
      return fields.kind === 'PERCENT'
        ? { ...fields, rate: current }
        : { ...fields, amount: current };
    }
    case 'currency':
      return { currency: ownCurrency(text, incomeCurrency) };
    case 'name':
      return { name: text };
    case 'startMonth':
      return { startMonth: text === '' ? null : text };
    case 'endMonth':
      return { endMonth: text === '' ? null : text };
    default:
      throw notEditable(key);
  }
}

export type DeductionDraftKey = 'name' | 'kind' | 'value' | 'currency' | 'startMonth' | 'endMonth';

export function deductionDraftInput(
  v: Record<DeductionDraftKey, string>,
  incomeCurrency: PlannerCurrency,
): DeductionCreateInput {
  const fixed = v.kind === 'FIXED';
  return {
    name: v.name,
    ...typeFields(v.kind),
    rate: fixed ? null : normalizeAmount(v.value),
    amount: fixed ? normalizeAmount(v.value) : null,
    currency: fixed && v.currency ? ownCurrency(v.currency, incomeCurrency) : null,
    startMonth: v.startMonth || null,
    endMonth: v.endMonth || null,
  };
}

/** The same deduction again (undo of a delete). */
export const deductionCopy = (
  d: DeductionDto,
  incomeCurrency: PlannerCurrency,
): DeductionCreateInput => ({
  name: d.name,
  kind: d.kind,
  rate: d.rate,
  base: d.base,
  amount: d.amount,
  currency: d.kind === 'FIXED' && d.currency !== incomeCurrency ? d.currency : null,
  startMonth: d.startMonth,
  endMonth: d.endMonth,
});

// ---- purchases -------------------------------------------------------------------------------

export type PurchaseColumn = ColumnKey<PurchaseDto>;

/**
 * Plain edits. The purchase date and the actual price go through «complete» instead
 * (`purchaseCompletion`), since they describe the purchase itself.
 */
export function purchaseChanges(key: PurchaseColumn, text: string): Changes<PurchaseUpdateInput> {
  switch (key) {
    case 'title':
      return { title: text };
    case 'category':
      return { category: optionValue(PURCHASE_CATEGORIES, text) };
    case 'priority':
      return { priority: optionValue(PURCHASE_PRIORITIES, text) };
    case 'currency':
      return { currency: optionValue(PLANNER_CURRENCIES, text) };
    case 'estimatedAmount':
      return { estimatedAmount: normalizeAmount(text) };
    case 'plannedMonth':
      return { plannedMonth: text === '' ? null : text };
    case 'ownerId':
      return { ownerId: text || null };
    default:
      throw notEditable(key);
  }
}

export const completesPurchase = (key: PurchaseColumn) =>
  key === 'purchasedOn' || key === 'actualAmount';

/** A changed purchase date or actual price; the other one keeps its current value. */
export function purchaseCompletion(p: PurchaseDto, key: PurchaseColumn, text: string) {
  return {
    purchasedOn: key === 'purchasedOn' ? text || null : p.purchasedOn,
    actualAmount:
      key === 'actualAmount' ? normalizeAmount(text) : (p.actualAmount ?? p.estimatedAmount),
  };
}

export type PurchaseDraftKey =
  'title' | 'category' | 'priority' | 'estimatedAmount' | 'currency' | 'plannedMonth';

export function purchaseDraftInput(v: Record<PurchaseDraftKey, string>): PurchaseCreateInput {
  return {
    title: v.title,
    category: optionValue(PURCHASE_CATEGORIES, v.category),
    priority: optionValue(PURCHASE_PRIORITIES, v.priority),
    currency: optionValue(PLANNER_CURRENCIES, v.currency),
    estimatedAmount: normalizeAmount(v.estimatedAmount),
    plannedMonth: v.plannedMonth || null,
  };
}

export const purchaseCopy = (p: PurchaseDto): PurchaseCreateInput => ({
  title: p.title,
  category: p.category,
  priority: p.priority,
  currency: p.currency,
  estimatedAmount: p.estimatedAmount,
  plannedMonth: p.plannedMonth,
  note: p.note,
});
