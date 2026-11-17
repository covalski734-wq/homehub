import { z } from 'zod';
import type { NoticeDto } from './notices';
import { isValidMonth } from './month';
import {
  FUND_RULE_MODES,
  PERCENT_BASES,
  percentSchema,
  plannerMoneySchema,
  type BaseCurrency,
  type FundRuleMode,
  type PercentBase,
  type PlannerCurrency,
} from './planner';
import { colorSchema } from './schemas';

/**
 * Household: members (who owns money), wealth (what the household has, without double counting),
 * fund plans and scenarios.
 */

/** Default member colours: violet, blue, then more for added members. */
export const MEMBER_COLORS = [
  '#8b5cf6',
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#ec4899',
  '#14b8a6',
  '#64748b',
] as const;
/** «Совместный» — any record without an owner. */
export const JOINT_COLOR = '#94a3b8';

const memberName = z
  .string()
  .trim()
  .min(1, 'VALIDATION_PERSON_NAME_REQUIRED')
  .max(40, 'VALIDATION_TOO_LONG');

export const memberCreateSchema = z.object({ name: memberName, color: colorSchema });
export type MemberCreateInput = z.input<typeof memberCreateSchema>;

export const memberUpdateSchema = z
  .object({ name: memberName, color: colorSchema, archived: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');
export type MemberUpdateInput = z.input<typeof memberUpdateSchema>;

export interface MemberDto {
  id: string;
  name: string;
  color: string;
  /** The login this member is; null for a member without one. */
  userId: string | null;
  archived: boolean;
}

// ---- fund plans ---------------------------------------------------------------------------------

const month = z.string().refine(isValidMonth, 'VALIDATION_MONTH_FORMAT');
const optionalMonth = z
  .union([month, z.literal('')])
  .nullish()
  .transform((value) => value || null);
const optionalMoney = z
  .union([plannerMoneySchema, z.literal('')])
  .nullish()
  .transform((value) => value || null);

/** The rule of a fund part, from `startMonth` on (a part has at most one rule). */
export const fundRuleSchema = z
  .object({
    mode: z.enum(FUND_RULE_MODES),
    amount: optionalMoney,
    percent: z
      .union([percentSchema, z.literal('')])
      .nullish()
      .transform((value) => value || null),
    percentBase: z
      .enum(PERCENT_BASES)
      .nullish()
      .transform((value) => value ?? null),
    min: optionalMoney,
    max: optionalMoney,
    priority: z.number().int().min(0).max(100).default(0),
    startMonth: month,
    endMonth: optionalMonth,
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'FIXED' && value.amount === null)
      ctx.addIssue({ code: 'custom', path: ['amount'], message: 'VALIDATION_AMOUNT_REQUIRED' });
    if (value.mode === 'PERCENT' && (value.percent === null || value.percentBase === null))
      ctx.addIssue({
        code: 'custom',
        path: ['percent'],
        message: 'VALIDATION_PERCENT_AND_BASE_REQUIRED',
      });
    if (value.min !== null && value.max !== null && Number(value.min) > Number(value.max))
      ctx.addIssue({ code: 'custom', path: ['max'], message: 'VALIDATION_MAX_BELOW_MIN' });
    if (value.endMonth && value.endMonth < value.startMonth)
      ctx.addIssue({ code: 'custom', path: ['endMonth'], message: 'VALIDATION_END_BEFORE_START' });
  });
export type FundRuleInput = z.input<typeof fundRuleSchema>;

/** One month's amount of a fund part; null removes the override (the rule applies again). */
export const fundOverrideSchema = z.object({
  month,
  amount: plannerMoneySchema.nullable(),
});
export type FundOverrideInput = z.input<typeof fundOverrideSchema>;

export interface FundRuleDto {
  mode: FundRuleMode;
  amount: string | null;
  percent: string | null;
  percentBase: PercentBase | null;
  min: string | null;
  max: string | null;
  priority: number;
  startMonth: string;
  endMonth: string | null;
}

// ---- scenarios ----------------------------------------------------------------------------------

export const SCENARIO_KINDS = ['PESSIMISTIC', 'BASE', 'OPTIMISTIC'] as const;
export type ScenarioKind = (typeof SCENARIO_KINDS)[number];

/** Change of incomes and expenses in percent (−20 = 20 % less). */
const signedPercent = z
  .string()
  .trim()
  .transform((value) => value.replace(',', '.'))
  .pipe(
    z
      .string()
      .regex(/^-?\d{1,3}(\.\d{1,2})?$/, 'VALIDATION_PERCENT_FORMAT')
      .refine((value) => Math.abs(Number(value)) <= 100, 'VALIDATION_PERCENT_RANGE'),
  );

export const scenarioUpdateSchema = z.object({
  kind: z.enum(['PESSIMISTIC', 'OPTIMISTIC']),
  income: signedPercent,
  expenses: signedPercent,
});
export type ScenarioUpdateInput = z.input<typeof scenarioUpdateSchema>;

/** One month of a scenario with its own percentages; null percentages remove the month. */
export const scenarioMonthSchema = z.object({
  kind: z.enum(['PESSIMISTIC', 'OPTIMISTIC']),
  month,
  income: signedPercent.nullable(),
  expenses: signedPercent.nullable(),
});
export type ScenarioMonthInput = z.input<typeof scenarioMonthSchema>;

export const scenarioQuerySchema = z.object({
  from: month,
  months: z.coerce.number<string | number>().int().min(1).max(36).default(12),
});

export interface ScenarioMonthDto {
  month: string;
  /** Percentages used this month, and whether they are the month's own. */
  incomePercent: string;
  expensesPercent: string;
  custom: boolean;
  netIncome: string;
  expenses: string;
  savings: string;
  free: string;
  deficit: string;
}

export interface ScenarioFundDto {
  potId: string;
  name: string;
  color: string | null;
  currency: PlannerCurrency;
  target: string | null;
  balance: string;
  /** Balance after the last month of the period. */
  projected: string;
  /** First month the target is reached; null — not within the period. */
  reachMonth: string | null;
}

export interface ScenarioDto {
  kind: ScenarioKind;
  income: string;
  expenses: string;
  months: ScenarioMonthDto[];
  totals: { netIncome: string; expenses: string; savings: string; deficit: string };
  funds: ScenarioFundDto[];
}

export interface ScenariosDto {
  baseCurrency: BaseCurrency;
  from: string;
  scenarios: ScenarioDto[];
}

// ---- wealth -------------------------------------------------------------------------------------

export interface WealthOwnerDto {
  /** Member id; null — совместный. */
  ownerId: string | null;
  name: string;
  color: string;
  /** Money on accounts, of it set aside in funds, and investments. */
  accounts: string;
  reserved: string;
  investments: string;
  /** Fund money kept outside any account (cash in a box). */
  outside: string;
  total: string;
}

export interface WealthGoalDto {
  potId: string;
  name: string;
  icon: string | null;
  color: string | null;
  currency: PlannerCurrency;
  balance: string;
  target: string | null;
  /** 0…100; null without a target. */
  progress: number | null;
  targetDate: string | null;
  /** Planned this month and deposited this month, fund currency. */
  planned: string;
  deposited: string;
  /** First month the plan reaches the target (12 months ahead at most); null — not reached. */
  forecastMonth: string | null;
}

export interface WealthDto {
  month: string;
  baseCurrency: BaseCurrency;
  /** Accounts + fund money outside accounts + investments; fund money on accounts counts once. */
  capital: string;
  accounts: string;
  /** Fund money kept on accounts: part of `accounts`, not added to it. */
  reserved: string;
  /** Accounts − reserved: money that is not set aside for anything. */
  free: string;
  outside: string;
  investments: string;
  owners: WealthOwnerDto[];
  goals: WealthGoalDto[];
  warnings: NoticeDto[];
  /** Values that could not be converted (no rate). */
  missingRates: string[];
}
