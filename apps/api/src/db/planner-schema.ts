import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { users, workspaces } from './schema';

/**
 * Budget planner tables (migration 0002). They only add to the existing schema.
 *
 * Planning model: an item (income source, regular expense) has a validity period
 * [start_month, end_month] and an amount history keyed by "effective from month". The amount
 * for month M is the latest history entry ≤ M, unless a one-month override exists. Changing an
 * amount "from now on" adds a history entry and never rewrites earlier months.
 *
 * Money is INTEGER minor units (scale 2). Months are TEXT "YYYY-MM". Every child table carries
 * workspace_id with a composite foreign key to its parent, so rows can never cross workspaces.
 */

const uuid = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const timestamp = (name: string) =>
  integer(name, { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());
const workspaceRef = () =>
  text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' });

const MONTH_GLOB = "GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'";
const isMonth = (column: string) =>
  sql.raw(`"${column}" ${MONTH_GLOB} AND substr("${column}", 6, 2) BETWEEN '01' AND '12'`);
const isOptionalMonth = (column: string) =>
  sql.raw(
    `"${column}" IS NULL OR ("${column}" ${MONTH_GLOB} AND substr("${column}", 6, 2) BETWEEN '01' AND '12')`,
  );
const isPlannerCurrency = (column: string) =>
  sql.raw(`"${column}" IN ('PLN', 'EUR', 'USD', 'CAD')`);
const endNotBeforeStart = sql.raw(`"end_month" IS NULL OR "end_month" >= "start_month"`);

export const plannerSettings = sqliteTable(
  'planner_settings',
  {
    workspaceId: text('workspace_id')
      .primaryKey()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    baseCurrency: text('base_currency', { enum: ['PLN', 'EUR'] })
      .notNull()
      .default('PLN'),
    /** Basis points: 2000 = 20.00 %. */
    defaultSavingsRateBp: integer('default_savings_rate_bp').notNull().default(2000),
    /** Migration 0019: money kept on everyday accounts before «свободный остаток» goes to funds. */
    minFreeMinor: integer('min_free_minor').notNull().default(0),
    /** Migration 0020: how joint lines without own shares split between members. */
    /**
     * Migration 0021: REMAINDER — everything left after expenses (above min_free) is savings,
     * split by the fund plans; RATE — the old savings percentage.
     */
    savingsMode: text('savings_mode', { enum: ['RATE', 'REMAINDER'] })
      .notNull()
      .default('RATE'),
    jointSplit: text('joint_split', { enum: ['EQUAL', 'INCOME'] })
      .notNull()
      .default('EQUAL'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    check('planner_settings_base_currency', sql`${t.baseCurrency} IN ('PLN', 'EUR')`),
    check('planner_settings_rate', sql`${t.defaultSavingsRateBp} BETWEEN 0 AND 10000`),
  ],
);

/** Per-user UI preferences (dashboard chart order, visibility and type). */
export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  dashboardLayout: text('dashboard_layout').notNull(),
  /** Display currency of this member; null follows the workspace setting. */
  baseCurrency: text('base_currency', { enum: ['PLN', 'EUR'] }),
  updatedAt: timestamp('updated_at'),
});

export const monthPlans = sqliteTable(
  'month_plans',
  {
    workspaceId: workspaceRef(),
    month: text('month').notNull(),
    savingsRateBp: integer('savings_rate_bp').notNull(),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.month] }),
    check('month_plans_month', isMonth('month')),
    check('month_plans_rate', sql`${t.savingsRateBp} BETWEEN 0 AND 10000`),
  ],
);

// ---------------------------------------------------------------------------
// Incomes
// ---------------------------------------------------------------------------

export const incomeSources = sqliteTable(
  'income_sources',
  {
    id: uuid(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['SALARY', 'BUSINESS', 'BENEFIT', 'OTHER'] }).notNull(),
    currency: text('currency').notNull(),
    startMonth: text('start_month').notNull(),
    endMonth: text('end_month'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Migration 0019: member id, NULL — совместный. */
    ownerId: text('owner_id'),
    /** Optimistic concurrency: every update must name the version it was based on. */
    version: integer('version').notNull().default(1),
    /** Stable origin of imported rows ("xlsx:<sheet>:<key>"); makes re-import idempotent. */
    sourceKey: text('source_key'),
    importBatchId: text('import_batch_id'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    unique('income_sources_id_workspace_unique').on(t.id, t.workspaceId),
    uniqueIndex('income_sources_source_key_unique').on(t.workspaceId, t.sourceKey),
    index('income_sources_workspace_idx').on(t.workspaceId),
    check('income_sources_kind', sql`${t.kind} IN ('SALARY', 'BUSINESS', 'BENEFIT', 'OTHER')`),
    check('income_sources_currency', isPlannerCurrency('currency')),
    check('income_sources_start', isMonth('start_month')),
    check('income_sources_end', isOptionalMonth('end_month')),
    check('income_sources_period', endNotBeforeStart),
  ],
);

export const incomeAmounts = sqliteTable(
  'income_amounts',
  {
    workspaceId: text('workspace_id').notNull(),
    incomeId: text('income_id').notNull(),
    effectiveMonth: text('effective_month').notNull(),
    amountMinor: integer('amount_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.incomeId, t.effectiveMonth] }),
    foreignKey({
      name: 'income_amounts_source_fk',
      columns: [t.incomeId, t.workspaceId],
      foreignColumns: [incomeSources.id, incomeSources.workspaceId],
    }).onDelete('cascade'),
    check('income_amounts_month', isMonth('effective_month')),
    check('income_amounts_non_negative', sql`${t.amountMinor} >= 0`),
  ],
);

export const incomeOverrides = sqliteTable(
  'income_overrides',
  {
    workspaceId: text('workspace_id').notNull(),
    incomeId: text('income_id').notNull(),
    month: text('month').notNull(),
    amountMinor: integer('amount_minor'),
    skipped: integer('skipped', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.incomeId, t.month] }),
    foreignKey({
      name: 'income_overrides_source_fk',
      columns: [t.incomeId, t.workspaceId],
      foreignColumns: [incomeSources.id, incomeSources.workspaceId],
    }).onDelete('cascade'),
    check('income_overrides_month', isMonth('month')),
    check(
      'income_overrides_value',
      sql`${t.skipped} = 1 OR (${t.amountMinor} IS NOT NULL AND ${t.amountMinor} >= 0)`,
    ),
  ],
);

/**
 * Taxes, contributions and commissions, applied in sort order: a percentage of gross, a percentage
 * of what is left after the deductions before it (base REMAINDER), or a fixed amount — optionally
 * in another currency than the income (e.g. a commission in PLN on a salary in EUR).
 */
export const incomeDeductions = sqliteTable(
  'income_deductions',
  {
    id: uuid(),
    workspaceId: text('workspace_id').notNull(),
    incomeId: text('income_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['PERCENT', 'FIXED'] }).notNull(),
    rateBp: integer('rate_bp'),
    /** PERCENT only: GROSS or REMAINDER. */
    base: text('base', { enum: ['GROSS', 'REMAINDER'] })
      .notNull()
      .default('GROSS'),
    amountMinor: integer('amount_minor'),
    /** FIXED only; NULL means the income currency. */
    currency: text('currency'),
    startMonth: text('start_month'),
    endMonth: text('end_month'),
    sortOrder: integer('sort_order').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    foreignKey({
      name: 'income_deductions_source_fk',
      columns: [t.incomeId, t.workspaceId],
      foreignColumns: [incomeSources.id, incomeSources.workspaceId],
    }).onDelete('cascade'),
    index('income_deductions_income_idx').on(t.incomeId),
    check(
      'income_deductions_shape',
      sql.raw(`("kind" = 'PERCENT' AND "rate_bp" BETWEEN 0 AND 10000 AND "amount_minor" IS NULL
          AND "currency" IS NULL AND "base" IN ('GROSS', 'REMAINDER'))
        OR ("kind" = 'FIXED' AND "amount_minor" >= 0 AND "rate_bp" IS NULL AND "base" = 'GROSS'
          AND ("currency" IS NULL OR "currency" IN ('PLN', 'EUR', 'USD', 'CAD')))`),
    ),
    check('income_deductions_start', isOptionalMonth('start_month')),
    check('income_deductions_end', isOptionalMonth('end_month')),
    check(
      'income_deductions_period',
      sql.raw(`"start_month" IS NULL OR "end_month" IS NULL OR "end_month" >= "start_month"`),
    ),
  ],
);

// ---------------------------------------------------------------------------
// Regular expenses
// ---------------------------------------------------------------------------

export const recurringExpenses = sqliteTable(
  'recurring_expenses',
  {
    id: uuid(),
    workspaceId: workspaceRef(),
    name: text('name').notNull(),
    isRequired: integer('is_required', { mode: 'boolean' }).notNull().default(false),
    /** Paid gradually during the month (food, ads): no single «paid» tick, prorated by days. */
    isOngoing: integer('is_ongoing', { mode: 'boolean' }).notNull().default(false),
    /** Spending window of an ongoing payment (null: from the 1st / to the last day). */
    ongoingStartDay: integer('ongoing_start_day'),
    ongoingEndDay: integer('ongoing_end_day'),
    /** A loan / installment plan; loan_total_minor overrides the schedule sum when set. */
    isLoan: integer('is_loan', { mode: 'boolean' }).notNull().default(false),
    loanTotalMinor: integer('loan_total_minor'),
    category: text('category').notNull(),
    currency: text('currency').notNull(),
    /** 1 = monthly, 3 = quarterly, 12 = yearly; counted from start_month. */
    intervalMonths: integer('interval_months').notNull().default(1),
    startMonth: text('start_month').notNull(),
    endMonth: text('end_month'),
    dueDay: integer('due_day'),
    note: text('note').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Migration 0019: member id, NULL — совместный. */
    ownerId: text('owner_id'),
    version: integer('version').notNull().default(1),
    sourceKey: text('source_key'),
    importBatchId: text('import_batch_id'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    unique('recurring_expenses_id_workspace_unique').on(t.id, t.workspaceId),
    uniqueIndex('recurring_expenses_source_key_unique').on(t.workspaceId, t.sourceKey),
    index('recurring_expenses_workspace_idx').on(t.workspaceId),
    check(
      'recurring_expenses_category',
      sql.raw(`"category" IN ('HOUSING', 'UTILITIES', 'FOOD', 'SUBSCRIPTIONS', 'COMMUNICATION',
        'EDUCATION', 'INSTALLMENTS', 'INSURANCE', 'TRANSPORT', 'HEALTH', 'CHILDREN', 'SERVICES',
        'OTHER')`),
    ),
    check('recurring_expenses_currency', isPlannerCurrency('currency')),
    check('recurring_expenses_required', sql`${t.isRequired} IN (0, 1)`),
    check('recurring_expenses_ongoing', sql`${t.isOngoing} IN (0, 1)`),
    check(
      'recurring_expenses_ongoing_start',
      sql`${t.ongoingStartDay} IS NULL OR ${t.ongoingStartDay} BETWEEN 1 AND 31`,
    ),
    check(
      'recurring_expenses_ongoing_end',
      sql`${t.ongoingEndDay} IS NULL OR ${t.ongoingEndDay} BETWEEN 1 AND 31`,
    ),
    check('recurring_expenses_loan', sql`${t.isLoan} IN (0, 1)`),
    check(
      'recurring_expenses_loan_total',
      sql`${t.loanTotalMinor} IS NULL OR ${t.loanTotalMinor} > 0`,
    ),
    check('recurring_expenses_interval', sql`${t.intervalMonths} BETWEEN 1 AND 12`),
    check('recurring_expenses_due_day', sql`${t.dueDay} IS NULL OR ${t.dueDay} BETWEEN 1 AND 31`),
    check('recurring_expenses_start', isMonth('start_month')),
    check('recurring_expenses_end', isOptionalMonth('end_month')),
    check('recurring_expenses_period', endNotBeforeStart),
  ],
);

/** Payment checkmarks are independent of planned amounts and never create transactions. */
export const recurringPayments = sqliteTable(
  'recurring_payments',
  {
    workspaceId: text('workspace_id').notNull(),
    expenseId: text('expense_id').notNull(),
    month: text('month').notNull(),
    paid: integer('paid', { mode: 'boolean' }).notNull().default(false),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.month] }),
    foreignKey({
      name: 'recurring_payments_expense_fk',
      columns: [t.expenseId, t.workspaceId],
      foreignColumns: [recurringExpenses.id, recurringExpenses.workspaceId],
    }).onDelete('cascade'),
    check('recurring_payments_month', isMonth('month')),
    check('recurring_payments_paid', sql`${t.paid} IN (0, 1)`),
  ],
);

export const recurringAmounts = sqliteTable(
  'recurring_amounts',
  {
    workspaceId: text('workspace_id').notNull(),
    expenseId: text('expense_id').notNull(),
    effectiveMonth: text('effective_month').notNull(),
    amountMinor: integer('amount_minor').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.effectiveMonth] }),
    foreignKey({
      name: 'recurring_amounts_expense_fk',
      columns: [t.expenseId, t.workspaceId],
      foreignColumns: [recurringExpenses.id, recurringExpenses.workspaceId],
    }).onDelete('cascade'),
    check('recurring_amounts_month', isMonth('effective_month')),
    check('recurring_amounts_non_negative', sql`${t.amountMinor} >= 0`),
  ],
);

export const recurringOverrides = sqliteTable(
  'recurring_overrides',
  {
    workspaceId: text('workspace_id').notNull(),
    expenseId: text('expense_id').notNull(),
    month: text('month').notNull(),
    amountMinor: integer('amount_minor'),
    skipped: integer('skipped', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.expenseId, t.month] }),
    foreignKey({
      name: 'recurring_overrides_expense_fk',
      columns: [t.expenseId, t.workspaceId],
      foreignColumns: [recurringExpenses.id, recurringExpenses.workspaceId],
    }).onDelete('cascade'),
    check('recurring_overrides_month', isMonth('month')),
    check(
      'recurring_overrides_value',
      sql`${t.skipped} = 1 OR (${t.amountMinor} IS NOT NULL AND ${t.amountMinor} >= 0)`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

/**
 * A wishlist item, independent of months. It belongs to exactly one month budget — its planned
 * month (or, if it was bought without a plan, the purchase month) — with the actual amount once
 * bought and the estimate before. That single rule makes double counting impossible.
 */
export const purchases = sqliteTable(
  'purchases',
  {
    id: uuid(),
    workspaceId: workspaceRef(),
    title: text('title').notNull(),
    category: text('category').notNull(),
    priority: text('priority', { enum: ['HIGH', 'MEDIUM', 'LOW'] }).notNull(),
    currency: text('currency').notNull(),
    estimatedAmountMinor: integer('estimated_amount_minor').notNull(),
    plannedMonth: text('planned_month'),
    status: text('status', { enum: ['ACTIVE', 'PURCHASED', 'CANCELLED'] }).notNull(),
    purchasedOn: text('purchased_on'),
    actualAmountMinor: integer('actual_amount_minor'),
    note: text('note').notNull().default(''),
    /** Migration 0019: member id, NULL — совместный. */
    ownerId: text('owner_id'),
    version: integer('version').notNull().default(1),
    sourceKey: text('source_key'),
    importBatchId: text('import_batch_id'),
    createdAt: timestamp('created_at'),
    updatedAt: timestamp('updated_at'),
  },
  (t) => [
    unique('purchases_id_workspace_unique').on(t.id, t.workspaceId),
    uniqueIndex('purchases_source_key_unique').on(t.workspaceId, t.sourceKey),
    index('purchases_workspace_planned_idx').on(t.workspaceId, t.plannedMonth),
    index('purchases_workspace_status_idx').on(t.workspaceId, t.status),
    check(
      'purchases_category',
      sql.raw(`"category" IN ('HOME', 'ELECTRONICS', 'CLOTHING', 'HEALTH', 'TRAVEL', 'EDUCATION',
        'GIFTS', 'TRANSPORT', 'HOBBY', 'OTHER')`),
    ),
    check('purchases_priority', sql`${t.priority} IN ('HIGH', 'MEDIUM', 'LOW')`),
    check('purchases_currency', isPlannerCurrency('currency')),
    check('purchases_estimate', sql`${t.estimatedAmountMinor} >= 0`),
    check('purchases_planned_month', isOptionalMonth('planned_month')),
    check(
      'purchases_status_shape',
      // A purchase known only by month (e.g. imported from a spreadsheet) has no invented date:
      // its planned month says which budget it belongs to.
      sql.raw(`("status" = 'PURCHASED' AND "actual_amount_minor" >= 0
          AND ("purchased_on" IS NOT NULL OR "planned_month" IS NOT NULL))
        OR ("status" IN ('ACTIVE', 'CANCELLED') AND "purchased_on" IS NULL AND "actual_amount_minor" IS NULL)`),
    ),
    check(
      'purchases_purchased_on',
      sql.raw(
        `"purchased_on" IS NULL OR "purchased_on" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'`,
      ),
    ),
  ],
);

/** Append-only history: planning, rescheduling, buying, cancelling. Written in the same batch. */
export const purchaseEvents = sqliteTable(
  'purchase_events',
  {
    id: uuid(),
    workspaceId: text('workspace_id').notNull(),
    purchaseId: text('purchase_id').notNull(),
    type: text('type').notNull(),
    fromMonth: text('from_month'),
    toMonth: text('to_month'),
    amountMinor: integer('amount_minor'),
    currency: text('currency'),
    eventDate: text('event_date'),
    createdById: text('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at'),
  },
  (t) => [
    foreignKey({
      name: 'purchase_events_purchase_fk',
      columns: [t.purchaseId, t.workspaceId],
      foreignColumns: [purchases.id, purchases.workspaceId],
    }).onDelete('cascade'),
    index('purchase_events_purchase_idx').on(t.purchaseId, t.createdAt),
    check(
      'purchase_events_type',
      sql.raw(`"type" IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'PURCHASED', 'UNPURCHASED',
        'CANCELLED', 'RESTORED')`),
    ),
  ],
);

// ---------------------------------------------------------------------------
// Exchange rates (public NBP data, shared by all workspaces) and import bookkeeping
// ---------------------------------------------------------------------------

/** NBP table A mid rates: PLN for one unit of `currency`, stored exactly as micro-units. */
export const exchangeRates = sqliteTable(
  'exchange_rates',
  {
    currency: text('currency').notNull(),
    effectiveDate: text('effective_date').notNull(),
    rateMicros: integer('rate_micros').notNull(),
    tableNo: text('table_no').notNull(),
    fetchedAt: timestamp('fetched_at'),
  },
  (t) => [
    primaryKey({ columns: [t.currency, t.effectiveDate] }),
    check('exchange_rates_positive', sql`${t.rateMicros} > 0`),
    check('exchange_rates_currency', sql`${t.currency} IN ('EUR', 'USD', 'CAD')`),
  ],
);

export const plannerState = sqliteTable('planner_state', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at'),
});

export const importBatches = sqliteTable(
  'import_batches',
  {
    id: text('id').primaryKey(),
    workspaceId: workspaceRef(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    planHash: text('plan_hash').notNull(),
    summary: text('summary').notNull(),
    appliedAt: timestamp('applied_at'),
  },
  (t) => [index('import_batches_workspace_idx').on(t.workspaceId)],
);

export const plannerSchema = {
  plannerSettings,
  userPreferences,
  monthPlans,
  incomeSources,
  incomeAmounts,
  incomeOverrides,
  incomeDeductions,
  recurringExpenses,
  recurringAmounts,
  recurringOverrides,
  purchases,
  purchaseEvents,
  exchangeRates,
  plannerState,
  importBatches,
};
