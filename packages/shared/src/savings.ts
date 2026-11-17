import { z } from 'zod';
import type { FundRuleDto } from './household';
import { isValidDate, isValidMonth } from './month';
import {
  plannerCurrencySchema,
  plannerMoneySchema,
  type BaseCurrency,
  type PlannerCurrency,
  type SavingsPlanDto,
} from './planner';
import { colorSchema } from './schemas';

/**
 * Savings: piggy banks («копилки») kept apart from everyday bookkeeping.
 *
 * - A CASH piggy bank holds money in one currency. Its balance is the opening balance plus
 *   deposits minus withdrawals plus returns. A withdrawal can be «в долг у копилки»: the amount
 *   becomes a required one-month payment «Вернуть в …» in the planner for the next month, and
 *   ticking that payment off puts the money back.
 * - A PORTFOLIO holds positions: quantities of CoinGecko assets (coins, gold tokens, tokenized
 *   stocks). Prices are fetched once a day in PLN and shown in the portfolio currency.
 */

export const POT_KINDS = ['CASH', 'PORTFOLIO'] as const;
export type PotKind = (typeof POT_KINDS)[number];

export const MOVEMENT_TYPES = ['DEPOSIT', 'WITHDRAWAL'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Coin quantities are exact decimals with up to 8 places (1 satoshi). */
export const CRYPTO_DECIMALS = 8;

const normalizeDecimal = (value: string) => value.trim().replace(/\s/g, '').replace(',', '.');

export const cryptoQuantitySchema = z
  .string({ error: 'VALIDATION_QUANTITY_REQUIRED' })
  .transform(normalizeDecimal)
  .pipe(
    z
      .string()
      .min(1, 'VALIDATION_QUANTITY_REQUIRED')
      .regex(/^\d{1,12}(\.\d{1,8})?$/, 'VALIDATION_QUANTITY_FORMAT'),
  );

const name = z.string().trim().min(1, 'VALIDATION_NAME_REQUIRED').max(60, 'VALIDATION_TOO_LONG');
const note = z.string().trim().max(200, 'VALIDATION_TOO_LONG');
const positiveMoney = plannerMoneySchema.refine(
  (value) => Number(value) > 0,
  'VALIDATION_AMOUNT_POSITIVE',
);
const savingsMonth = z.string().refine(isValidMonth, 'VALIDATION_MONTH_FORMAT');
const savingsDate = z.string().refine(isValidDate, 'VALIDATION_DATE_FORMAT');

const optionalUuid = z
  .union([z.uuid(), z.literal('')])
  .nullish()
  .transform((value) => value || null);
const optionalMoney = z
  .union([plannerMoneySchema, z.literal('')])
  .nullish()
  .transform((value) => value || null);
const optionalColor = z
  .union([colorSchema, z.literal('')])
  .nullish()
  .transform((value) => value || null);
const optionalDate = z
  .union([savingsDate, z.literal('')])
  .nullish()
  .transform((value) => value || null);
const icon = z
  .string()
  .trim()
  .max(8, 'VALIDATION_ICON_EMOJI')
  .nullish()
  .transform((value) => value || null);

/** Goal fields of a fund (CASH pot); portfolios use only owner and colour. */
const fundFields = {
  ownerId: optionalUuid,
  target: optionalMoney,
  targetDate: optionalDate,
  priority: z.number().int().min(0).max(100).default(0),
  icon,
  color: optionalColor,
  description: note.default(''),
  note: z.string().trim().max(1000, 'VALIDATION_TOO_LONG').default(''),
  /** Counted in the month but not in «всего накоплено» (e.g. money for current spending). */
  excludeFromTotal: z.boolean().default(false),
};

export const potCreateSchema = z.object({
  name,
  kind: z.enum(POT_KINDS),
  currency: plannerCurrencySchema,
  /** CASH: what is already there; it goes to the first part. */
  balance: plannerMoneySchema.default('0'),
  ...fundFields,
});
export type PotCreateInput = z.input<typeof potCreateSchema>;

export const potUpdateSchema = z
  .object({
    name,
    /** PORTFOLIO, or a fund without history: the currency. */
    currency: plannerCurrencySchema,
    archived: z.boolean(),
    // Update fields carry no defaults: a field that is not sent stays as it is.
    ownerId: z.uuid().nullable(),
    target: plannerMoneySchema.nullable(),
    targetDate: savingsDate.nullable(),
    priority: z.number().int().min(0).max(100),
    icon: z.string().trim().max(8, 'VALIDATION_ICON_EMOJI').nullable(),
    color: colorSchema.nullable(),
    description: note,
    note: z.string().trim().max(1000, 'VALIDATION_TOO_LONG'),
    excludeFromTotal: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');
export type PotUpdateInput = z.input<typeof potUpdateSchema>;

/** A part of a fund: owner, colour, the real account the money lies on, opening balance. */
export const subaccountCreateSchema = z.object({
  name,
  /** The part's own currency; the fund's when omitted. */
  currency: plannerCurrencySchema.nullish().transform((value) => value ?? null),
  ownerId: optionalUuid,
  color: optionalColor,
  accountId: optionalUuid,
  balance: plannerMoneySchema.default('0'),
  note: note.default(''),
});
export type SubaccountCreateInput = z.input<typeof subaccountCreateSchema>;

export const subaccountUpdateSchema = z
  .object({
    name,
    currency: plannerCurrencySchema,
    ownerId: z.uuid().nullable(),
    color: colorSchema.nullable(),
    accountId: z.uuid().nullable(),
    /** The real balance now: the opening is adjusted, history stays. */
    balance: plannerMoneySchema,
    note,
    archived: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');
export type SubaccountUpdateInput = z.input<typeof subaccountUpdateSchema>;

export const movementCreateSchema = z.object({
  type: z.enum(MOVEMENT_TYPES),
  amount: positiveMoney,
  date: savingsDate,
  note: note.default(''),
  /** The fund part; may be omitted when the fund has one part. */
  subaccountId: optionalUuid,
  /**
   * DEPOSIT: NEW — new money arrives on the part's account (its balance grows); ACCOUNT — moved
   * from `fromAccountId` (a transfer); RESERVE — already on the part's account, only set aside.
   */
  source: z.enum(['NEW', 'ACCOUNT', 'RESERVE']).default('NEW'),
  /** WITHDRAWAL: the money stays on the account (only no longer set aside). */
  keepOnAccount: z.boolean().default(false),
  /**
   * DEPOSIT from another real account than the part's: the money is also transferred there (an
   * operation). Without it the deposit only sets aside money already on the part's account.
   */
  fromAccountId: optionalUuid,
  /** WITHDRAWAL: the month to put the money back in (a planner payment); null — not returned. */
  repayMonth: z
    .union([savingsMonth, z.literal('')])
    .nullish()
    .transform((value) => value || null),
});
export type MovementCreateInput = z.input<typeof movementCreateSchema>;

/** An automatic monthly deposit or withdrawal of a fund part. */
export const autoRuleCreateSchema = z.object({
  type: z.enum(MOVEMENT_TYPES),
  amount: positiveMoney,
  day: z.number().int().min(1, 'VALIDATION_DAY_OF_MONTH').max(31, 'VALIDATION_DAY_OF_MONTH'),
  startMonth: savingsMonth,
  endMonth: z
    .union([savingsMonth, z.literal('')])
    .nullish()
    .transform((value) => value || null),
  note: note.default(''),
});
export type AutoRuleCreateInput = z.input<typeof autoRuleCreateSchema>;

export const autoRuleUpdateSchema = z
  .object({
    day: z.number().int().min(1).max(31),
    endMonth: savingsMonth.nullable(),
    note,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');

/** «Только в этом месяце» or «в этом и последующих». */
export const autoAmountSchema = z.object({
  month: savingsMonth,
  amount: plannerMoneySchema,
  scope: z.enum(['MONTH', 'FORWARD']),
});
export type AutoAmountInput = z.input<typeof autoAmountSchema>;

export interface AutoRuleDto {
  id: string;
  type: MovementType;
  /** Amount for the shown month (override or history), in the part's currency. */
  amount: string;
  /** The shown month uses a one-month amount. */
  overridden: boolean;
  day: number;
  startMonth: string;
  endMonth: string | null;
  note: string;
  /** The movement of the shown month is already made. */
  done: boolean;
}

/** Fix a deposit or withdrawal: another amount, date (and so month) or comment. */
export const movementUpdateSchema = z
  .object({ amount: positiveMoney, date: savingsDate, note })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');
export type MovementUpdateInput = z.input<typeof movementUpdateSchema>;

export const movementMoveSchema = z.object({ repayMonth: savingsMonth });
export const movementReturnedSchema = z.object({ returned: z.boolean() });

/** An asset as CoinGecko knows it; `id` is the CoinGecko id ("bitcoin", "nvidia-xstock"). */
export const assetSchema = z.object({
  id: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{0,99}$/, 'VALIDATION_UNKNOWN_ASSET'),
  symbol: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  image: z
    .string()
    .regex(/^https:\/\/(coin-images|assets)\.coingecko\.com\/[\w./-]+(\?\d+)?$/)
    .nullish()
    .transform((value) => value ?? null),
});

/** Average purchase price of one unit, in the portfolio currency (up to 8 decimals). */
const avgPrice = z
  .union([
    z
      .string()
      .transform(normalizeDecimal)
      .pipe(z.string().regex(/^\d{1,12}(\.\d{1,8})?$/, 'VALIDATION_PRICE_FORMAT')),
    z.literal(''),
  ])
  .nullish()
  .transform((value) => value || null);

export const positionCreateSchema = z
  .object({
    asset: assetSchema,
    /** Either the quantity, or the value in the portfolio currency at today's price. */
    quantity: z
      .union([cryptoQuantitySchema, z.literal('')])
      .nullish()
      .transform((value) => value || null),
    value: z
      .union([positiveMoney, z.literal('')])
      .nullish()
      .transform((value) => value || null),
    avgPrice,
  })
  .refine((value) => (value.quantity === null) !== (value.value === null), {
    message: 'VALIDATION_QUANTITY_OR_AMOUNT_REQUIRED',
    path: ['quantity'],
  });
export type PositionCreateInput = z.input<typeof positionCreateSchema>;

export const positionUpdateSchema = z
  .object({ quantity: cryptoQuantitySchema, avgPrice })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'VALIDATION_NO_CHANGES');
export type PositionUpdateInput = z.input<typeof positionUpdateSchema>;

export const assetSearchSchema = z.object({ q: z.string().trim().min(1).max(50) });

// ---------------------------------------------------------------------------
// Response DTOs
// ---------------------------------------------------------------------------

export interface AssetDto {
  id: string;
  symbol: string;
  name: string;
  image: string | null;
}

export interface PositionDto {
  id: string;
  asset: AssetDto;
  quantity: string;
  /** Price of one unit in the portfolio currency; null without a price or rate. */
  price: string | null;
  value: string | null;
  /** Value change over the last 24 hours, in the portfolio currency. */
  change24h: string | null;
  priceDate: string | null;
  /** The price is older than two days: shown, but not as the current one. */
  stale: boolean;
  /** Average purchase price of one unit and what it cost; profit or loss at the current price. */
  avgPrice: string | null;
  cost: string | null;
  profit: string | null;
}

export interface RepaymentDto {
  month: string;
  /** The planner payment «Вернуть в …»; null once it was deleted there. */
  expenseId: string | null;
  returned: boolean;
  /** Not returned and its month is over. */
  overdue: boolean;
}

export interface MovementDto {
  id: string;
  type: MovementType;
  amount: string;
  currency: PlannerCurrency;
  date: string;
  note: string;
  repayment: RepaymentDto | null;
  subaccountId: string | null;
  /** The transfer between accounts the deposit made. */
  transactionId: string | null;
  /** Made by an automatic operation (its note is empty unless the rule has one). */
  auto: boolean;
  createdAt: string;
}

export interface SubaccountDto {
  id: string;
  name: string;
  currency: PlannerCurrency;
  /** Balance in the fund's currency (parts in other currencies converted at today's rate). */
  valueInFund: string | null;
  autoRules: AutoRuleDto[];
  ownerId: string | null;
  color: string | null;
  /** The real account the money lies on (reserved there); null — kept outside accounts. */
  accountId: string | null;
  balance: string;
  owed: string;
  note: string;
  archived: boolean;
  /** This month: planned (by rule or override), deposited, and the balance once the plan is done. */
  planned: string;
  deposited: string;
  forecast: string;
  rule: FundRuleDto | null;
  /** The plan of the shown month is a one-month override. */
  overridden: boolean;
}

export interface PotDto {
  id: string;
  name: string;
  kind: PotKind;
  currency: PlannerCurrency;
  archived: boolean;
  /** CASH: the balance; PORTFOLIO: the sum of the positions that have a price. */
  balance: string;
  /** The same in the display currency; null without a rate. */
  value: string | null;
  /** PORTFOLIO: value change over 24 hours. */
  change24h: string | null;
  /** Withdrawn and not returned yet, in the pot currency. */
  owed: string;
  positions: PositionDto[];
  /** Newest first: every unreturned withdrawal and the latest movements. */
  movements: MovementDto[];
  ownerId: string | null;
  color: string | null;
  icon: string | null;
  target: string | null;
  targetDate: string | null;
  priority: number;
  description: string;
  note: string;
  /** 0…100 of the target; null without one. */
  progress: number | null;
  subaccounts: SubaccountDto[];
  /** Fund totals of the shown month: planned, deposited, balance after the plan. */
  planned: string;
  deposited: string;
  /** Taken out this month (fund currency). */
  withdrawn: string;
  forecast: string;
  /** First month the plan reaches the target (36 months ahead at most). */
  forecastMonth: string | null;
  excludeFromTotal: boolean;
  /** PORTFOLIO: cost of the positions that have an average price, and the profit on them. */
  cost: string | null;
  profit: string | null;
}

export interface PricesStatusDto {
  lastSuccessAt: string | null;
  lastError: string | null;
  stale: boolean;
  /** CoinGecko asked to wait (429) or is down: nothing is requested before this moment. */
  retryAt: string | null;
  /** The «обновить курс» button works again from this moment (null: now). */
  refreshAvailableAt: string | null;
}

export interface SavingsOverviewDto {
  month: string;
  baseCurrency: BaseCurrency;
  pots: PotDto[];
  /** Sum of the active pots in the display currency (those that convert). */
  total: string;
  /** Withdrawn and not returned yet, in the display currency. */
  owed: string;
  /** The month's savings target from the budget, and what went into piggy banks that month. */
  savingsTarget: string;
  deposited: string;
  /** Taken out of the funds this month. */
  withdrawn: string;
  /** Of the target: planned to funds, and what is still to be distributed. */
  distributed: string;
  unallocated: string;
  prices: PricesStatusDto;
  /** The savings plan of the month (fund parts or the savings rate). */
  plan: SavingsPlanDto;
}

export interface FundPartEventDto {
  id: string;
  subaccountId: string;
  accountId: string | null;
  partName: string;
  type: 'ADDED' | 'REMOVED' | 'RESTORED';
  createdAt: string;
}
