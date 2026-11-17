import { z } from 'zod';
import type { NoticeDto } from './notices';
import { isValidDate, isValidMonth } from './month';

/**
 * Budget planner: the family plans incomes, regular payments, savings and larger purchases
 * per month. Everyday spending is deliberately not tracked here.
 */

export const PLANNER_CURRENCIES = ['PLN', 'EUR', 'USD', 'CAD'] as const;
export type PlannerCurrency = (typeof PLANNER_CURRENCIES)[number];

export const BASE_CURRENCIES = ['PLN', 'EUR'] as const;
export type BaseCurrency = (typeof BASE_CURRENCIES)[number];

export const INCOME_KINDS = ['SALARY', 'BUSINESS', 'BENEFIT', 'OTHER'] as const;
export type IncomeKind = (typeof INCOME_KINDS)[number];

/** Taxes, social contributions, bank or platform commissions — configured, never hard-coded. */
export const DEDUCTION_KINDS = ['PERCENT', 'FIXED'] as const;
export type DeductionKind = (typeof DEDUCTION_KINDS)[number];

/**
 * What a percentage applies to: the gross income, or what is left after the deductions listed
 * before it (e.g. a 6 % tax charged after a platform commission).
 */
export const DEDUCTION_BASES = ['GROSS', 'REMAINDER'] as const;
export type DeductionBase = (typeof DEDUCTION_BASES)[number];

export const RECURRING_CATEGORIES = [
  'HOUSING',
  'UTILITIES',
  'FOOD',
  'SUBSCRIPTIONS',
  'COMMUNICATION',
  'EDUCATION',
  'INSTALLMENTS',
  'INSURANCE',
  'TRANSPORT',
  'HEALTH',
  'CHILDREN',
  'SERVICES',
  'OTHER',
] as const;
export type RecurringCategory = (typeof RECURRING_CATEGORIES)[number];

export const PURCHASE_CATEGORIES = [
  'HOME',
  'ELECTRONICS',
  'CLOTHING',
  'HEALTH',
  'TRAVEL',
  'EDUCATION',
  'GIFTS',
  'TRANSPORT',
  'HOBBY',
  'OTHER',
] as const;
export type PurchaseCategory = (typeof PURCHASE_CATEGORIES)[number];

export const PURCHASE_PRIORITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;
export type PurchasePriority = (typeof PURCHASE_PRIORITIES)[number];

export const PURCHASE_STATUSES = ['ACTIVE', 'PURCHASED', 'CANCELLED'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export const PURCHASE_EVENT_TYPES = [
  'CREATED',
  'UPDATED',
  'RESCHEDULED',
  'PURCHASED',
  'UNPURCHASED',
  'CANCELLED',
  'RESTORED',
] as const;
export type PurchaseEventType = (typeof PURCHASE_EVENT_TYPES)[number];

/** MONTH: only the given month changes. FORWARD: the new amount applies from that month on. */
export const AMOUNT_SCOPES = ['MONTH', 'FORWARD'] as const;
export type AmountScope = (typeof AMOUNT_SCOPES)[number];

export const CHART_IDS = [
  'trend',
  'structure',
  'savings',
  'purchases',
  'balance',
  'categories',
] as const;
export type ChartId = (typeof CHART_IDS)[number];

export const CHART_TYPES = {
  trend: ['bar', 'line', 'area'],
  structure: ['bars', 'donut'],
  savings: ['bar', 'line'],
  purchases: ['bar', 'list'],
  balance: ['bar', 'line'],
  categories: ['stacked', 'area'],
} as const satisfies Record<ChartId, readonly string[]>;

export const DEFAULT_SAVINGS_RATE = '20.00';

/** REMAINDER: all money left after expenses is savings, split by fund plans; RATE: a percentage. */
export const SAVINGS_MODES = ['REMAINDER', 'RATE'] as const;
export type SavingsMode = (typeof SAVINGS_MODES)[number];

export const JOINT_SPLITS = ['EQUAL', 'INCOME'] as const;
export type JointSplit = (typeof JOINT_SPLITS)[number];

// ---------------------------------------------------------------------------
// Value schemas
// ---------------------------------------------------------------------------

const normalizeDecimal = (value: string) => value.trim().replace(/\s/g, '').replace(',', '.');

/** Non-negative amount ("0" allowed: a planned income can be zero for a month). */
export const plannerMoneySchema = z
  .string({ error: 'VALIDATION_AMOUNT_REQUIRED' })
  .transform(normalizeDecimal)
  .pipe(
    z
      .string()
      .min(1, 'VALIDATION_AMOUNT_REQUIRED')
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'VALIDATION_AMOUNT_FORMAT'),
  );

/** Percentage 0–100 with up to 2 decimals ("20", "12,5"). */
export const percentSchema = z
  .string({ error: 'VALIDATION_PERCENT_REQUIRED' })
  .transform(normalizeDecimal)
  .pipe(
    z
      .string()
      .regex(/^\d{1,3}(\.\d{1,2})?$/, 'VALIDATION_PERCENT_FORMAT')
      .refine((value) => Number(value) <= 100, 'VALIDATION_PERCENT_MAX'),
  );

export const plannerCurrencySchema = z.enum(PLANNER_CURRENCIES, 'VALIDATION_PLANNER_CURRENCY');
export const baseCurrencySchema = z.enum(BASE_CURRENCIES);
const plannerMonth = z.string().refine(isValidMonth, 'VALIDATION_MONTH_FORMAT');
const plannerDate = z.string().refine(isValidDate, 'VALIDATION_DATE_FORMAT');
const optionalMonth = z
  .union([plannerMonth, z.literal('')])
  .nullish()
  .transform((value) => value || null);
const name = z.string().trim().min(1, 'VALIDATION_NAME_REQUIRED').max(120, 'VALIDATION_TOO_LONG');
const note = z.string().trim().max(500, 'VALIDATION_TOO_LONG');
const version = z.number().int().min(1);
/** A member id; null — совместный. */
export const ownerSchema = z.uuid('VALIDATION_UNKNOWN_MEMBER').nullable();
const optionalUuid = z
  .union([z.uuid(), z.literal('')])
  .nullish()
  .transform((value) => value || null);

function endNotBeforeStart(value: { startMonth?: string | null; endMonth?: string | null }) {
  return !value.startMonth || !value.endMonth || value.endMonth >= value.startMonth;
}
const endAfterStart = { message: 'VALIDATION_END_BEFORE_START', path: ['endMonth'] };

// ---------------------------------------------------------------------------
// Settings, month plan, dashboard layout
// ---------------------------------------------------------------------------

export const plannerSettingsUpdateSchema = z
  .object({
    baseCurrency: baseCurrencySchema,
    defaultSavingsRate: percentSchema,
    /** Kept on everyday accounts before «свободный остаток» goes to funds. */
    minFree: plannerMoneySchema,
    /** Joint lines without their own shares: split equally or by the members' incomes. */
    jointSplit: z.enum(JOINT_SPLITS),
    savingsMode: z.enum(SAVINGS_MODES),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');
export type PlannerSettingsUpdate = z.input<typeof plannerSettingsUpdateSchema>;

/** `savingsRate: null` returns the month to the workspace default. */
export const monthPlanUpdateSchema = z.object({ savingsRate: percentSchema.nullable() });
export type MonthPlanUpdate = z.input<typeof monthPlanUpdateSchema>;

/** Groups of the dashboard «left to pay» card that can be switched off as a whole. */
export const REMAINING_GROUPS = ['required', 'other', 'purchases'] as const;
export type RemainingGroup = (typeof REMAINING_GROUPS)[number];
export const REMAINING_EXCLUDED_LIMIT = 300;

const chartSetting = <T extends ChartId>(id: T) =>
  z.object({
    id: z.literal(id),
    visible: z.boolean(),
    type: z.enum(CHART_TYPES[id] as unknown as [string, ...string[]]),
  });

export const dashboardLayoutSchema = z.object({
  charts: z
    .array(
      z.discriminatedUnion('id', [
        chartSetting('trend'),
        chartSetting('structure'),
        chartSetting('savings'),
        chartSetting('purchases'),
        chartSetting('balance'),
        chartSetting('categories'),
      ]),
    )
    .max(CHART_IDS.length)
    .refine(
      (charts) => new Set(charts.map((c) => c.id)).size === charts.length,
      'VALIDATION_DUPLICATE_CHART',
    ),
  /** «Left to pay» card: what the user chose not to count (absent = everything counts). */
  remaining: z
    .object({
      /** Switched-off payments: `r:<recurring id>` or `p:<purchase id>`, for every month. */
      excluded: z.array(z.string().min(1).max(64)).max(REMAINING_EXCLUDED_LIMIT),
      hiddenGroups: z
        .array(z.enum(REMAINING_GROUPS))
        .max(REMAINING_GROUPS.length)
        .refine((groups) => new Set(groups).size === groups.length, 'VALIDATION_DUPLICATE_GROUP'),
    })
    .optional(),
});
export type DashboardLayout = z.output<typeof dashboardLayoutSchema>;

export const DEFAULT_DASHBOARD_LAYOUT: DashboardLayout = {
  charts: [
    { id: 'trend', visible: true, type: 'bar' },
    { id: 'structure', visible: true, type: 'bars' },
    { id: 'savings', visible: true, type: 'bar' },
    { id: 'balance', visible: true, type: 'bar' },
    { id: 'categories', visible: true, type: 'stacked' },
    { id: 'purchases', visible: false, type: 'list' },
  ],
};

// ---------------------------------------------------------------------------
// Incomes
// ---------------------------------------------------------------------------

export const incomeKindSchema = z.enum(INCOME_KINDS);

export const incomeCreateSchema = z
  .object({
    name,
    kind: incomeKindSchema.default('SALARY'),
    currency: plannerCurrencySchema.default('PLN'),
    amount: plannerMoneySchema,
    startMonth: plannerMonth,
    endMonth: optionalMonth,
    ownerId: ownerSchema.default(null),
  })
  .refine(endNotBeforeStart, endAfterStart);
export type IncomeCreateInput = z.input<typeof incomeCreateSchema>;

export const incomeUpdateSchema = z
  .object({
    name,
    kind: incomeKindSchema,
    currency: plannerCurrencySchema,
    startMonth: plannerMonth,
    endMonth: optionalMonth,
    sortOrder: z.number().int().min(0).max(10_000),
    ownerId: ownerSchema,
  })
  .partial()
  .extend({ version })
  .refine(endNotBeforeStart, endAfterStart);
export type IncomeUpdateInput = z.input<typeof incomeUpdateSchema>;

export const amountChangeSchema = z.object({
  month: plannerMonth,
  amount: plannerMoneySchema,
  scope: z.enum(AMOUNT_SCOPES).default('MONTH'),
});
export type AmountChangeInput = z.input<typeof amountChangeSchema>;

export const deductionCreateSchema = z
  .object({
    name,
    kind: z.enum(DEDUCTION_KINDS),
    rate: percentSchema.nullish(),
    base: z.enum(DEDUCTION_BASES).default('GROSS'),
    amount: plannerMoneySchema.nullish(),
    /** Currency of a fixed amount; empty means the income currency. */
    currency: plannerCurrencySchema.nullish(),
    startMonth: optionalMonth,
    endMonth: optionalMonth,
  })
  .refine((v) => (v.kind === 'PERCENT' ? Boolean(v.rate) : Boolean(v.amount)), {
    message: 'VALIDATION_RATE_OR_AMOUNT_REQUIRED',
    path: ['rate'],
  })
  .refine(endNotBeforeStart, endAfterStart);
export type DeductionCreateInput = z.input<typeof deductionCreateSchema>;

export const deductionUpdateSchema = z
  .object({
    name,
    kind: z.enum(DEDUCTION_KINDS),
    rate: percentSchema.nullable(),
    base: z.enum(DEDUCTION_BASES),
    amount: plannerMoneySchema.nullable(),
    currency: plannerCurrencySchema.nullable(),
    startMonth: optionalMonth,
    endMonth: optionalMonth,
  })
  .partial()
  .extend({ version })
  .refine(endNotBeforeStart, endAfterStart);
export type DeductionUpdateInput = z.input<typeof deductionUpdateSchema>;

// ---------------------------------------------------------------------------
// Recurring expenses
// ---------------------------------------------------------------------------

export const recurringCategorySchema = z.enum(RECURRING_CATEGORIES);
const dueDay = z
  .number()
  .int()
  .min(1, 'VALIDATION_DAY_OF_MONTH')
  .max(31, 'VALIDATION_DAY_OF_MONTH')
  .nullable();
/** Spending window of an ongoing payment inside a month (null: from the 1st / to the last day). */
const windowDay = dueDay;
const windowInOrder = (v: { ongoingStartDay?: number | null; ongoingEndDay?: number | null }) =>
  typeof v.ongoingStartDay !== 'number' ||
  typeof v.ongoingEndDay !== 'number' ||
  v.ongoingEndDay >= v.ongoingStartDay;
const windowMessage = { message: 'VALIDATION_END_DAY_BEFORE_START', path: ['ongoingEndDay'] };
const loanTotal = plannerMoneySchema.nullable();

export const recurringCreateSchema = z
  .object({
    name,
    isRequired: z.boolean().default(false),
    isOngoing: z.boolean().default(false),
    ongoingStartDay: windowDay.default(null),
    ongoingEndDay: windowDay.default(null),
    isLoan: z.boolean().default(false),
    loanTotal: loanTotal.default(null),
    category: recurringCategorySchema.default('OTHER'),
    currency: plannerCurrencySchema.default('PLN'),
    amount: plannerMoneySchema,
    intervalMonths: z.number().int().min(1).max(12).default(1),
    startMonth: plannerMonth,
    endMonth: optionalMonth,
    dueDay: dueDay.default(null),
    note: note.default(''),
    ownerId: ownerSchema.default(null),
  })
  .refine(endNotBeforeStart, endAfterStart)
  .refine(windowInOrder, windowMessage);
export type RecurringCreateInput = z.input<typeof recurringCreateSchema>;

export const recurringUpdateSchema = z
  .object({
    name,
    isRequired: z.boolean(),
    isOngoing: z.boolean(),
    ongoingStartDay: windowDay,
    ongoingEndDay: windowDay,
    isLoan: z.boolean(),
    loanTotal,
    category: recurringCategorySchema,
    currency: plannerCurrencySchema,
    intervalMonths: z.number().int().min(1).max(12),
    startMonth: plannerMonth,
    endMonth: optionalMonth,
    dueDay,
    note,
    sortOrder: z.number().int().min(0).max(10_000),
    ownerId: ownerSchema,
  })
  .partial()
  .extend({ version })
  .refine(endNotBeforeStart, endAfterStart)
  .refine(windowInOrder, windowMessage);
export type RecurringUpdateInput = z.input<typeof recurringUpdateSchema>;

export const skipMonthSchema = z.object({ month: plannerMonth, skipped: z.boolean() });
/** The fact of a payment: what was really paid, when, from which account, by whom. */
export const actualPaymentSchema = z.object({
  amount: plannerMoneySchema.refine((value) => Number(value) > 0, 'VALIDATION_AMOUNT_POSITIVE'),
  date: plannerDate,
  accountId: z.uuid('VALIDATION_ACCOUNT_REQUIRED'),
  payerId: optionalUuid,
  note: note.default(''),
});
export type ActualPaymentInput = z.input<typeof actualPaymentSchema>;

/** «Оплачено»: with an actual payment the amount is also written off the account (an operation). */
export const recurringPaymentSchema = z.object({
  month: plannerMonth,
  paid: z.boolean(),
  actual: actualPaymentSchema.nullish().transform((value) => value ?? null),
});
export type RecurringPaymentInput = z.input<typeof recurringPaymentSchema>;

/** A planned income received: the operation on the account it came to. */
export const incomeReceiptSchema = actualPaymentSchema.extend({ month: plannerMonth });
export type IncomeReceiptInput = z.input<typeof incomeReceiptSchema>;

/** Removing a planned item from a month on: earlier months keep it (history is never rewritten). */
export const stopFromMonthSchema = z.object({ month: plannerMonth });

// ---------------------------------------------------------------------------
// Purchases (wishlist independent of months)
// ---------------------------------------------------------------------------

export const purchaseCreateSchema = z.object({
  title: name,
  category: z.enum(PURCHASE_CATEGORIES).default('OTHER'),
  priority: z.enum(PURCHASE_PRIORITIES).default('MEDIUM'),
  currency: plannerCurrencySchema.default('PLN'),
  estimatedAmount: plannerMoneySchema,
  plannedMonth: optionalMonth,
  note: note.default(''),
  ownerId: ownerSchema.default(null),
});
export type PurchaseCreateInput = z.input<typeof purchaseCreateSchema>;

export const purchaseUpdateSchema = z
  .object({
    title: name,
    category: z.enum(PURCHASE_CATEGORIES),
    priority: z.enum(PURCHASE_PRIORITIES),
    currency: plannerCurrencySchema,
    estimatedAmount: plannerMoneySchema,
    plannedMonth: optionalMonth,
    note,
    ownerId: ownerSchema,
  })
  .partial()
  .extend({ version });
export type PurchaseUpdateInput = z.input<typeof purchaseUpdateSchema>;

export const purchaseCompleteSchema = z.object({
  /** Null keeps "bought in the planned month" without inventing a date. */
  purchasedOn: plannerDate.nullable(),
  actualAmount: plannerMoneySchema,
  version,
  /** Written off this account as an operation (dated by the purchase date or today). */
  accountId: optionalUuid,
  payerId: optionalUuid,
});
export type PurchaseCompleteInput = z.input<typeof purchaseCompleteSchema>;

export const versionOnlySchema = z.object({ version });

export const purchaseQuerySchema = z.object({
  status: z.enum(PURCHASE_STATUSES).optional(),
  month: plannerMonth.optional(),
});

// ---------------------------------------------------------------------------
// Response DTOs (amounts are decimal strings; "base" = converted to the base currency)
// ---------------------------------------------------------------------------

export interface PlannerSettingsDto {
  baseCurrency: BaseCurrency;
  defaultSavingsRate: string;
  minFree: string;
  jointSplit: JointSplit;
  savingsMode: SavingsMode;
  currencies: readonly PlannerCurrency[];
}

/** Shares of a joint line between members; an empty list returns it to the default split. */
export const itemSharesSchema = z
  .object({
    shares: z
      .array(z.object({ memberId: z.uuid(), share: percentSchema }))
      .max(20)
      .refine(
        (list) => new Set(list.map((s) => s.memberId)).size === list.length,
        'VALIDATION_DUPLICATE_MEMBER',
      ),
  })
  .refine(
    (value) =>
      value.shares.length === 0 ||
      value.shares.reduce((sum, s) => sum + Math.round(Number(s.share) * 100), 0) === 10000,
    { message: 'VALIDATION_SHARES_TOTAL', path: ['shares'] },
  );
export type ItemSharesInput = z.input<typeof itemSharesSchema>;

export interface ShareDto {
  memberId: string;
  share: string;
}

/** The month of one member: own lines plus their share of the joint ones. */
export interface OwnerBudgetDto {
  ownerId: string;
  netIncome: string;
  expenses: string;
  savings: string;
  free: string;
}

export interface ExchangeRateDto {
  currency: PlannerCurrency;
  /** PLN for one unit of the currency (NBP table A mid rate). */
  rate: string;
  effectiveDate: string;
}

export interface RatesStatusDto {
  rates: ExchangeRateDto[];
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  /** True when the newest stored rate is older than 5 days (fallback in use). */
  stale: boolean;
}

export interface DeductionDto {
  id: string;
  name: string;
  kind: DeductionKind;
  rate: string | null;
  base: DeductionBase;
  amount: string | null;
  /** Currency of a fixed amount (the income currency unless set otherwise). */
  currency: PlannerCurrency;
  startMonth: string | null;
  endMonth: string | null;
  version: number;
  /** Amount withheld in the given month, in the income currency (null without a rate). */
  monthAmount: string | null;
  active: boolean;
}

/** An operation that is the fact of a planned line. */
export interface PlanFactDto {
  transactionId: string;
  amount: string;
  currency: string;
  date: string;
  accountId: string;
  payerId: string | null;
}

export interface IncomeLineDto {
  id: string;
  name: string;
  ownerId: string | null;
  /** Own split of a joint line; null — the household default. */
  shares: ShareDto[] | null;
  /** Received this month (the operation); null — not yet. */
  received: PlanFactDto | null;
  kind: IncomeKind;
  currency: PlannerCurrency;
  startMonth: string;
  endMonth: string | null;
  version: number;
  /** Whether the source contributes to the month (inside start/end and not skipped). */
  active: boolean;
  /** The month uses a one-off amount instead of the source's regular amount. */
  overridden: boolean;
  gross: string;
  deductions: DeductionDto[];
  deductionsTotal: string;
  net: string;
  grossBase: string | null;
  deductionsBase: string | null;
  netBase: string | null;
}

export interface RecurringLineDto {
  id: string;
  name: string;
  ownerId: string | null;
  shares: ShareDto[] | null;
  /** The operation written off when it was marked paid with an amount. */
  actual: PlanFactDto | null;
  /** «Вернуть в …» of a fund withdrawal: paying it refills the fund, no account operation. */
  isFundReturn: boolean;
  isRequired: boolean;
  /** Paid gradually during the month: no «paid» tick; what is left is prorated by days. */
  isOngoing: boolean;
  /** Spending window of an ongoing payment (null: 1st / last day of the month). */
  ongoingStartDay: number | null;
  ongoingEndDay: number | null;
  /** A loan or installment plan: tracked on the Loans page (total, paid, remaining). */
  isLoan: boolean;
  /** Total to repay when it differs from the payment schedule; null: computed. */
  loanTotal: string | null;
  paid: boolean;
  category: RecurringCategory;
  currency: PlannerCurrency;
  intervalMonths: number;
  startMonth: string;
  endMonth: string | null;
  dueDay: number | null;
  note: string;
  version: number;
  /** Due in the selected month (schedule, period and skip applied). */
  active: boolean;
  skipped: boolean;
  overridden: boolean;
  amount: string;
  base: string | null;
}

export interface PurchaseDto {
  id: string;
  title: string;
  ownerId: string | null;
  shares: ShareDto[] | null;
  actual: PlanFactDto | null;
  category: PurchaseCategory;
  priority: PurchasePriority;
  currency: PlannerCurrency;
  estimatedAmount: string;
  plannedMonth: string | null;
  status: PurchaseStatus;
  purchasedOn: string | null;
  actualAmount: string | null;
  note: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** The month whose budget includes the purchase (exactly one, or none). */
  budgetMonth: string | null;
  /** Actual amount once bought, otherwise the estimate. */
  budgetAmount: string;
}

export interface PurchaseEventDto {
  id: string;
  type: PurchaseEventType;
  fromMonth: string | null;
  toMonth: string | null;
  amount: string | null;
  currency: PlannerCurrency | null;
  date: string | null;
  createdAt: string;
  createdBy: { name: string | null; email: string } | null;
}

export interface BudgetTotalsDto {
  grossIncome: string;
  deductions: string;
  netIncome: string;
  recurring: string;
  purchases: string;
  savingsTarget: string;
  /** Net income − regular payments − purchases − savings target. Negative = over-planned. */
  free: string;
}

export interface BudgetBreakdownDto {
  key: string;
  kind: 'recurring' | 'purchases';
  amount: string;
}

export interface MonthBudgetDto {
  month: string;
  baseCurrency: BaseCurrency;
  savingsRate: string;
  savingsRateIsDefault: boolean;
  totals: BudgetTotalsDto;
  incomes: IncomeLineDto[];
  recurring: RecurringLineDto[];
  purchases: PurchaseDto[];
  breakdown: BudgetBreakdownDto[];
  rates: ExchangeRateDto[];
  /** Currencies without any known rate: their lines are excluded from base totals. */
  missingRates: PlannerCurrency[];
  savingsPlan: SavingsPlanDto;
  /** Per member: own lines plus their share of joint ones (empty without members). */
  byOwner: OwnerBudgetDto[];
  /** Plan against fact of the month (operations); only in the month budget, not in trends. */
  fact: MonthFactDto | null;
}

export const FUND_RULE_MODES = ['FIXED', 'PERCENT', 'REMAINDER'] as const;
export type FundRuleMode = (typeof FUND_RULE_MODES)[number];
export const PERCENT_BASES = ['NET_INCOME', 'OWNER_INCOME', 'FREE'] as const;
export type PercentBase = (typeof PERCENT_BASES)[number];

/** A fund part's planned contribution for the month. */
export interface SavingsPlanLineDto {
  subaccountId: string;
  potId: string;
  potName: string;
  name: string;
  ownerId: string | null;
  color: string | null;
  currency: PlannerCurrency;
  mode: FundRuleMode | 'OVERRIDE' | 'DEPOSIT';
  /** Planned amount in the fund currency and in the display currency. */
  planned: string;
  plannedBase: string | null;
  /** Deposited this month (the fact), fund currency. */
  deposited: string;
  /** The rule wanted more than the money left allowed (remainder or deficit). */
  limited: boolean;
}

export interface SavingsPlanDto {
  /** RATE: the old «процент накоплений»; FUNDS: the sum of the fund plans (and the rest). */
  source: 'RATE' | 'FUNDS';
  /** REMAINDER mode: savings left after the fund plans, not assigned to any fund. */
  unallocated: string;
  lines: SavingsPlanLineDto[];
  total: string;
  /** Net income − regular payments − purchases, before any savings. */
  freeBeforeSavings: string;
  /** How much the plan exceeds the money (0 when it fits). */
  deficit: string;
  warnings: NoticeDto[];
}

export interface PlanFactRowDto {
  key: string;
  kind: 'income' | 'recurring' | 'purchases';
  plan: string;
  fact: string;
}

export interface MonthFactDto {
  income: { plan: string; fact: string };
  expenses: { plan: string; fact: string };
  savings: { plan: string; fact: string };
  /** By planner category; facts without a plan are listed with plan 0. */
  rows: PlanFactRowDto[];
  /** Spent outside any planned line. */
  unplanned: string;
  /** Operations in currencies without a rate are left out. */
  missingRates: string[];
}

export interface PlannerTrendPointDto {
  month: string;
  grossIncome: string;
  netIncome: string;
  deductions: string;
  recurring: string;
  purchases: string;
  savingsTarget: string;
  free: string;
  savingsRate: string;
  /** Spending by category in this month, as in the month budget. */
  breakdown: BudgetBreakdownDto[];
}

export interface PlannerTrendDto {
  baseCurrency: BaseCurrency;
  points: PlannerTrendPointDto[];
}

// ---------------------------------------------------------------------------
// Loans and installment plans (regular expenses marked as loans)
// ---------------------------------------------------------------------------

export interface LoanDto {
  id: string;
  name: string;
  currency: PlannerCurrency;
  startMonth: string;
  endMonth: string | null;
  intervalMonths: number;
  /** Amount of the next payment (or the last one when everything is paid). */
  payment: string;
  /** null when the loan has no end month. */
  paymentsTotal: number | null;
  paymentsPaid: number;
  /** Total to repay: entered by hand or the sum of the schedule; null without an end month. */
  total: string | null;
  paid: string;
  remaining: string | null;
  /** First unpaid payment month; null when nothing is left. Months before the current one count
   * as paid; the current one when ticked off. */
  nextMonth: string | null;
  /** The total was entered by hand (otherwise it is the sum of the schedule). */
  totalIsManual: boolean;
  paymentBase: string | null;
  remainingBase: string | null;
}

export interface LoansDto {
  baseCurrency: BaseCurrency;
  month: string;
  loans: LoanDto[];
}
