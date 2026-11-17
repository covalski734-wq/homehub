import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { recurringExpenses } from './planner-schema';
import { users, workspaces } from './schema';

/**
 * Savings (migration 0018): piggy banks kept apart from the bookkeeping accounts.
 *
 * A CASH pot's balance = opening + deposits − withdrawals + returned withdrawals. A withdrawal to
 * be returned owns a one-month required planner payment (`repay_expense_id`); it counts as
 * returned once that payment is ticked off in `repay_month`. A PORTFOLIO pot holds positions.
 *
 * Coin quantities are TEXT decimals with up to 8 places: satoshis of a large holding do not fit a
 * JS number, and the API speaks decimal strings anyway.
 */

const QUANTITY = (column: string) =>
  sql.raw(`"${column}" GLOB '[0-9]*' AND "${column}" NOT GLOB '*[^0-9.]*'`);
const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' }).notNull();
const workspaceRef = () =>
  text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' });

export const savingsPots = sqliteTable(
  'savings_pots',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['CASH', 'PORTFOLIO'] }).notNull(),
    currency: text('currency').notNull(),
    /** Before 0019 the CASH balance lived here; since then it is the subaccounts' opening. */
    openingMinor: integer('opening_minor').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    /** Migration 0019: a fund is a goal — target, date, priority, look. */
    ownerId: text('owner_id'),
    targetMinor: integer('target_minor'),
    targetDate: text('target_date'),
    priority: integer('priority').notNull().default(0),
    icon: text('icon'),
    color: text('color'),
    description: text('description').notNull().default(''),
    note: text('note').notNull().default(''),
    /** Migration 0022: counted in the month (deposits, plan) but not in «всего накоплено». */
    excludeFromTotal: integer('exclude_from_total', { mode: 'boolean' }).notNull().default(false),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('savings_pots_workspace_idx').on(t.workspaceId),
    check('savings_pots_name', sql`length(${t.name}) BETWEEN 1 AND 60`),
    check('savings_pots_kind', sql`${t.kind} IN ('CASH', 'PORTFOLIO')`),
    check('savings_pots_currency', sql`${t.currency} IN ('PLN', 'EUR', 'USD', 'CAD')`),
  ],
);

export const savingsPositions = sqliteTable(
  'savings_positions',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    potId: text('pot_id')
      .notNull()
      .references(() => savingsPots.id, { onDelete: 'cascade' }),
    /** CoinGecko id ("bitcoin", "nvidia-xstock"). */
    asset: text('asset').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    image: text('image'),
    quantity: text('quantity').notNull(),
    /** Migration 0019: average purchase price of one unit, micro-units of the pot currency. */
    avgPriceMicros: integer('avg_price_micros'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    uniqueIndex('savings_positions_pot_asset_unique').on(t.potId, t.asset),
    index('savings_positions_asset_idx').on(t.asset),
    check('savings_positions_quantity', QUANTITY('quantity')),
  ],
);

export const savingsMovements = sqliteTable(
  'savings_movements',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    potId: text('pot_id')
      .notNull()
      .references(() => savingsPots.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['DEPOSIT', 'WITHDRAWAL'] }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    occurredOn: text('occurred_on').notNull(),
    note: text('note').notNull().default(''),
    repayMonth: text('repay_month'),
    repayExpenseId: text('repay_expense_id').references(() => recurringExpenses.id, {
      onDelete: 'set null',
    }),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    /** Migration 0019: the fund part it belongs to; the transfer it made between accounts. */
    subaccountId: text('subaccount_id'),
    transactionId: text('transaction_id'),
    /** Migration 0021: made by an automatic operation for this month. */
    autoRuleId: text('auto_rule_id'),
    /** Migration 0022: the money put back on the account when the withdrawal was returned. */
    returnTransactionId: text('return_transaction_id'),
    autoMonth: text('auto_month'),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    index('savings_movements_pot_idx').on(t.potId, t.occurredOn),
    index('savings_movements_subaccount_idx').on(t.subaccountId),
    uniqueIndex('savings_movements_auto_unique').on(t.autoRuleId, t.autoMonth),
    index('savings_movements_expense_idx').on(t.repayExpenseId),
    index('savings_movements_workspace_idx').on(t.workspaceId),
    check('savings_movements_type', sql`${t.type} IN ('DEPOSIT', 'WITHDRAWAL')`),
    check('savings_movements_amount', sql`${t.amountMinor} > 0`),
    check(
      'savings_movements_date',
      sql.raw(`"occurred_on" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'`),
    ),
    check(
      'savings_movements_repay',
      sql.raw(
        `"repay_month" IS NULL OR ("type" = 'WITHDRAWAL' AND "repay_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("repay_month", 6, 2) BETWEEN '01' AND '12')`,
      ),
    ),
  ],
);

/**
 * A part of a fund: whose money it is, where it physically lies (`account_id`, a real account —
 * then the money is a reservation on that account, not extra money), its own colour and history.
 * Balance = opening + deposits − withdrawals + returned withdrawals of this part.
 */
export const fundSubaccounts = sqliteTable(
  'fund_subaccounts',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    potId: text('pot_id')
      .notNull()
      .references(() => savingsPots.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    ownerId: text('owner_id'),
    color: text('color'),
    accountId: text('account_id'),
    /** Migration 0021: a part has its own currency (a fund can hold PLN and EUR parts). */
    currency: text('currency'),
    openingMinor: integer('opening_minor').notNull().default(0),
    note: text('note').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('fund_subaccounts_pot_idx').on(t.potId),
    index('fund_subaccounts_account_idx').on(t.accountId),
    index('fund_subaccounts_workspace_idx').on(t.workspaceId),
    check('fund_subaccounts_name', sql`length(${t.name}) BETWEEN 1 AND 60`),
  ],
);

/**
 * How much a fund part gets each month from `start_month` on: a fixed amount (pot currency), a
 * percentage of a base (net income, the owner's net income, or the free money), or a share of
 * what is left after everything else (by priority, with limits).
 */
export const fundRules = sqliteTable(
  'fund_rules',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    subaccountId: text('subaccount_id')
      .notNull()
      .references(() => fundSubaccounts.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: ['FIXED', 'PERCENT', 'REMAINDER'] }).notNull(),
    amountMinor: integer('amount_minor'),
    percentBp: integer('percent_bp'),
    percentBase: text('percent_base', { enum: ['NET_INCOME', 'OWNER_INCOME', 'FREE'] }),
    minMinor: integer('min_minor'),
    maxMinor: integer('max_minor'),
    priority: integer('priority').notNull().default(0),
    startMonth: text('start_month').notNull(),
    endMonth: text('end_month'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('fund_rules_subaccount_idx').on(t.subaccountId),
    index('fund_rules_workspace_idx').on(t.workspaceId),
    check('fund_rules_mode', sql`${t.mode} IN ('FIXED', 'PERCENT', 'REMAINDER')`),
    check(
      'fund_rules_shape',
      sql.raw(`("mode" = 'FIXED' AND "amount_minor" >= 0)
        OR ("mode" = 'PERCENT' AND "percent_bp" BETWEEN 0 AND 10000 AND "percent_base" IN ('NET_INCOME', 'OWNER_INCOME', 'FREE'))
        OR "mode" = 'REMAINDER'`),
    ),
    check('fund_rules_period', sql.raw(`"end_month" IS NULL OR "end_month" >= "start_month"`)),
  ],
);

/** One month's amount of a fund part, replacing what its rule gives (pot currency). */
export const fundPlanOverrides = sqliteTable(
  'fund_plan_overrides',
  {
    workspaceId: workspaceRef(),
    subaccountId: text('subaccount_id')
      .notNull()
      .references(() => fundSubaccounts.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.subaccountId, t.month] }),
    check('fund_plan_overrides_amount', sql`${t.amountMinor} >= 0`),
  ],
);

/**
 * An automatic monthly deposit or withdrawal of a fund part (from `start_month`, on `day`).
 * Its amount has a history like planner items: «с этого месяца» adds an entry, a one-month change
 * is an override. Each month's movement is created once (`savings_movements.auto_month`).
 */
export const fundAutoRules = sqliteTable(
  'fund_auto_rules',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    subaccountId: text('subaccount_id')
      .notNull()
      .references(() => fundSubaccounts.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['DEPOSIT', 'WITHDRAWAL'] }).notNull(),
    day: integer('day').notNull(),
    startMonth: text('start_month').notNull(),
    endMonth: text('end_month'),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    index('fund_auto_rules_subaccount_idx').on(t.subaccountId),
    index('fund_auto_rules_workspace_idx').on(t.workspaceId),
    check('fund_auto_rules_type', sql`${t.type} IN ('DEPOSIT', 'WITHDRAWAL')`),
    check('fund_auto_rules_day', sql`${t.day} BETWEEN 1 AND 31`),
    check('fund_auto_rules_period', sql.raw(`"end_month" IS NULL OR "end_month" >= "start_month"`)),
  ],
);

export const fundAutoAmounts = sqliteTable(
  'fund_auto_amounts',
  {
    workspaceId: workspaceRef(),
    ruleId: text('rule_id')
      .notNull()
      .references(() => fundAutoRules.id, { onDelete: 'cascade' }),
    /** From this month on (FORWARD) or this month only (`one_month` = 1). */
    month: text('month').notNull(),
    oneMonth: integer('one_month', { mode: 'boolean' }).notNull().default(false),
    amountMinor: integer('amount_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ruleId, t.month, t.oneMonth] }),
    check('fund_auto_amounts_amount', sql`${t.amountMinor} >= 0`),
  ],
);

/** Shares of a joint income, expense or purchase between members (basis points, sum 10 000). */
export const itemShares = sqliteTable(
  'item_shares',
  {
    workspaceId: workspaceRef(),
    itemId: text('item_id').notNull(),
    memberId: text('member_id').notNull(),
    shareBp: integer('share_bp').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.memberId] }),
    index('item_shares_workspace_idx').on(t.workspaceId),
    check('item_shares_bp', sql`${t.shareBp} BETWEEN 0 AND 10000`),
  ],
);

/** One month of a scenario with its own percentages instead of the scenario's. */
export const scenarioMonths = sqliteTable(
  'scenario_months',
  {
    workspaceId: workspaceRef(),
    kind: text('kind', { enum: ['PESSIMISTIC', 'OPTIMISTIC'] }).notNull(),
    month: text('month').notNull(),
    incomeBp: integer('income_bp').notNull(),
    expenseBp: integer('expense_bp').notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.kind, t.month] }),
    check('scenario_months_income', sql`${t.incomeBp} BETWEEN -10000 AND 10000`),
    check('scenario_months_expense', sql`${t.expenseBp} BETWEEN -10000 AND 10000`),
  ],
);

/** Pessimistic / optimistic variants: incomes and expenses changed by a percentage. */
export const plannerScenarios = sqliteTable(
  'planner_scenarios',
  {
    workspaceId: workspaceRef(),
    kind: text('kind', { enum: ['PESSIMISTIC', 'OPTIMISTIC'] }).notNull(),
    incomeBp: integer('income_bp').notNull(),
    expenseBp: integer('expense_bp').notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.kind] }),
    check('planner_scenarios_kind', sql`${t.kind} IN ('PESSIMISTIC', 'OPTIMISTIC')`),
    check('planner_scenarios_income', sql`${t.incomeBp} BETWEEN -10000 AND 10000`),
    check('planner_scenarios_expense', sql`${t.expenseBp} BETWEEN -10000 AND 10000`),
  ],
);

/** Daily asset prices in PLN micro-units (public data, shared by all workspaces). */
export const assetPrices = sqliteTable(
  'asset_prices',
  {
    asset: text('asset').notNull(),
    priceDate: text('price_date').notNull(),
    pricePlnMicros: integer('price_pln_micros').notNull(),
    /** 24-hour change in basis points of the price (−149 = −1.49 %). */
    change24hBp: integer('change_24h_bp'),
    fetchedAt: timestamp('fetched_at'),
  },
  (t) => [
    primaryKey({ columns: [t.asset, t.priceDate] }),
    check('asset_prices_positive', sql`${t.pricePlnMicros} > 0`),
  ],
);

/** Audit trail survives removing a part from a fund. */
export const fundPartEvents = sqliteTable(
  'fund_part_events',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    potId: text('pot_id')
      .notNull()
      .references(() => savingsPots.id, { onDelete: 'cascade' }),
    subaccountId: text('subaccount_id').notNull(),
    accountId: text('account_id'),
    partName: text('part_name').notNull(),
    type: text('type', { enum: ['ADDED', 'REMOVED', 'RESTORED'] }).notNull(),
    createdAt: timestamp('created_at'),
  },
  (t) => [index('fund_part_events_pot_idx').on(t.workspaceId, t.potId)],
);
