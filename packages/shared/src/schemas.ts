import { z } from 'zod';
import { ACCOUNT_TYPES, CATEGORY_KINDS, TRANSACTION_TYPES } from './enums';
import { isValidDate, isValidMonth } from './month';
import { RECURRING_CATEGORIES } from './planner';

/** Plan/fact rows of a month: the regular-expense categories plus planned purchases. */
export const PLAN_FACT_KEYS = [...RECURRING_CATEGORIES, 'PURCHASES'] as const;
export type PlanFactKey = (typeof PLAN_FACT_KEYS)[number];

/** A colour as #rrggbb (lower case). */
export const colorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, 'VALIDATION_COLOR_FORMAT');

const MONEY_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;
const SIGNED_MONEY_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;

const normalizeDecimal = (value: string) => value.trim().replace(/\s/g, '').replace(',', '.');

/** Positive money amount as a decimal string ("1500", "12.5", "12,50" is accepted). */
export const moneySchema = z
  .string({ error: 'VALIDATION_AMOUNT_REQUIRED' })
  .transform(normalizeDecimal)
  .pipe(
    z
      .string()
      .min(1, 'VALIDATION_AMOUNT_REQUIRED')
      .regex(MONEY_PATTERN, 'VALIDATION_AMOUNT_FORMAT')
      .refine((value) => Number(value) > 0, 'VALIDATION_AMOUNT_POSITIVE'),
  );

export const signedMoneySchema = z
  .string()
  .transform(normalizeDecimal)
  .pipe(z.string().regex(SIGNED_MONEY_PATTERN, 'VALIDATION_AMOUNT_INVALID'));

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'VALIDATION_CURRENCY_CODE');

export const monthSchema = z.string().refine(isValidMonth, 'VALIDATION_MONTH_FORMAT');
export const dateSchema = z.string().refine(isValidDate, 'VALIDATION_DATE_FORMAT');
export const idSchema = z.uuid('VALIDATION_UUID');

/** Accepts "" from empty form controls and turns it into null. */
const optionalId = z
  .union([idSchema, z.literal('')])
  .nullish()
  .transform((value) => value || null);

const optionalMoney = z
  .union([moneySchema, z.literal('')])
  .nullish()
  .transform((value) => value || null);

export const transactionTypeSchema = z.enum(TRANSACTION_TYPES);
export const accountTypeSchema = z.enum(ACCOUNT_TYPES);
export const categoryKindSchema = z.enum(CATEGORY_KINDS);

export const transactionInputSchema = z
  .object({
    type: transactionTypeSchema,
    accountId: idSchema,
    toAccountId: optionalId,
    categoryId: optionalId,
    amount: moneySchema,
    toAmount: optionalMoney,
    description: z.string().trim().max(200, 'VALIDATION_TOO_LONG').default(''),
    occurredAt: dateSchema,
    /** Who actually paid or received; null — совместно. */
    payerId: optionalId,
    /** Planner category for plan/fact; derived from the category when omitted. */
    plannerCategory: z
      .union([z.enum(PLAN_FACT_KEYS), z.literal('')])
      .nullish()
      .transform((value) => value || null),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'TRANSFER') {
      if (!value.toAccountId) {
        ctx.addIssue({
          code: 'custom',
          path: ['toAccountId'],
          message: 'VALIDATION_TO_ACCOUNT_REQUIRED',
        });
      } else if (value.toAccountId === value.accountId) {
        ctx.addIssue({
          code: 'custom',
          path: ['toAccountId'],
          message: 'VALIDATION_SAME_ACCOUNTS',
        });
      }
      if (value.categoryId) {
        ctx.addIssue({
          code: 'custom',
          path: ['categoryId'],
          message: 'VALIDATION_TRANSFER_HAS_NO_CATEGORY',
        });
      }
      return;
    }
    if (!value.categoryId) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'VALIDATION_CATEGORY_REQUIRED',
      });
    }
    if (value.toAccountId || value.toAmount) {
      ctx.addIssue({
        code: 'custom',
        path: ['toAccountId'],
        message: 'VALIDATION_TO_ACCOUNT_ONLY_FOR_TRANSFER',
      });
    }
  });
export type TransactionInput = z.input<typeof transactionInputSchema>;
export type TransactionPayload = z.output<typeof transactionInputSchema>;

export const TRANSACTION_SORT_FIELDS = ['occurredAt', 'amount', 'createdAt'] as const;
export type TransactionSortField = (typeof TRANSACTION_SORT_FIELDS)[number];

export const transactionQuerySchema = z.object({
  month: monthSchema.optional(),
  type: transactionTypeSchema.optional(),
  accountId: idSchema.optional(),
  categoryId: idSchema.optional(),
  page: z.coerce.number<string | number>().int().min(1).default(1),
  pageSize: z.coerce.number<string | number>().int().min(1).max(100).default(25),
  sortBy: z.enum(TRANSACTION_SORT_FIELDS).default('occurredAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export type TransactionQuery = z.output<typeof transactionQuerySchema>;
export type TransactionQueryInput = z.input<typeof transactionQuerySchema>;

export const accountCreateSchema = z.object({
  name: z.string().trim().min(1, 'VALIDATION_NAME_REQUIRED').max(60, 'VALIDATION_TOO_LONG'),
  type: accountTypeSchema,
  currency: currencySchema,
  initialBalance: signedMoneySchema.default('0'),
  ownerId: optionalId,
  color: colorSchema.nullish().transform((value) => value ?? null),
  note: z.string().trim().max(300, 'VALIDATION_TOO_LONG').default(''),
});
export type AccountCreateInput = z.input<typeof accountCreateSchema>;
export type AccountCreatePayload = z.output<typeof accountCreateSchema>;

/** Only the fields sent change: no defaults here, a missing field must stay as it is. */
export const accountUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'VALIDATION_NAME_REQUIRED').max(60, 'VALIDATION_TOO_LONG'),
    type: accountTypeSchema,
    currency: currencySchema,
    initialBalance: signedMoneySchema,
    ownerId: idSchema.nullable(),
    color: colorSchema.nullable(),
    note: z.string().trim().max(300, 'VALIDATION_TOO_LONG'),
    archived: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');
export type AccountUpdateInput = z.input<typeof accountUpdateSchema>;
export type AccountUpdatePayload = z.output<typeof accountUpdateSchema>;

/** Sets the real balance: the difference becomes a reconciliation, not income or spending. */
export const reconcileSchema = z.object({ balance: signedMoneySchema, date: dateSchema });

/** Money put on an account without a planned line (a gift, savings brought from elsewhere). */
export const accountTopupSchema = z.object({
  amount: moneySchema,
  date: dateSchema,
  note: z.string().trim().max(200, 'VALIDATION_TOO_LONG').default(''),
});

export const summaryQuerySchema = z.object({ month: monthSchema });
export type SummaryQuery = z.output<typeof summaryQuerySchema>;

export const budgetQuerySchema = z.object({ month: monthSchema });

export const budgetUpsertSchema = z.object({
  month: monthSchema,
  categoryId: idSchema,
  currency: currencySchema,
  limit: moneySchema,
});
export type BudgetUpsertInput = z.input<typeof budgetUpsertSchema>;
export type BudgetUpsertPayload = z.output<typeof budgetUpsertSchema>;

export const budgetCopySchema = z
  .object({ fromMonth: monthSchema, toMonth: monthSchema })
  .refine((value) => value.fromMonth !== value.toMonth, {
    message: 'VALIDATION_SAME_MONTHS',
    path: ['toMonth'],
  });
export type BudgetCopyPayload = z.output<typeof budgetCopySchema>;
