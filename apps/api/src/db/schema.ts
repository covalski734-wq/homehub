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
} from 'drizzle-orm/sqlite-core';

/**
 * D1 (SQLite) schema.
 *
 * - Money is stored as INTEGER minor units at a fixed scale of 2 (1500.50 → 150050).
 *   SQLite has no exact DECIMAL type; integers are exact, and the API still speaks "1500.50".
 * - Operation dates are TEXT "YYYY-MM-DD" (calendar dates, no time zone).
 * - Timestamps are INTEGER milliseconds since epoch.
 * - Composite foreign keys (id, workspace_id) make cross-workspace references impossible
 *   at the database level. Triggers in the integrity migration add the rules SQLite
 *   cannot express as CHECK constraints (currency/category consistency).
 */

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date());
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

const CURRENCY_GLOB = "'[A-Z][A-Z][A-Z]'";
const isCurrency = (column: string) => sql.raw(`${column} GLOB ${CURRENCY_GLOB}`);

export const users = sqliteTable('users', {
  id: id(),
  loginId: text('login_id').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  lastLoginAt: integer('last_login_at', { mode: 'timestamp_ms' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  /** Stable key of the shared household workspace ("home"); lets concurrent first logins converge on one row. */
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['OWNER', 'MEMBER'] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('workspace_members_user_id_idx').on(t.userId),
    check('workspace_members_role_check', sql`${t.role} IN ('OWNER', 'MEMBER')`),
  ],
);

/** The browser holds only the raw token (HttpOnly cookie); the database stores its SHA-256 hash. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    tokenHash: text('token_hash').notNull().unique(),
    csrfToken: text('csrf_token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: createdAt(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    type: text('type', { enum: ['CASH', 'CARD', 'BANK', 'SAVINGS', 'OTHER'] }).notNull(),
    currency: text('currency').notNull(),
    initialBalanceMinor: integer('initial_balance_minor').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    /** Migration 0019: a member id (checked by the services), NULL — совместный. */
    ownerId: text('owner_id'),
    color: text('color'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('accounts_id_workspace_id_unique').on(t.id, t.workspaceId),
    index('accounts_workspace_id_idx').on(t.workspaceId),
    check('accounts_type_check', sql`${t.type} IN ('CASH', 'CARD', 'BANK', 'SAVINGS', 'OTHER')`),
    check('accounts_currency_check', isCurrency('"currency"')),
  ],
);

export const categories = sqliteTable(
  'categories',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    systemKey: text('system_key'),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['INCOME', 'EXPENSE'] }).notNull(),
    color: text('color').notNull().default('#6b7280'),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('categories_id_workspace_id_unique').on(t.id, t.workspaceId),
    unique('categories_workspace_id_system_key_unique').on(t.workspaceId, t.systemKey),
    index('categories_workspace_id_idx').on(t.workspaceId),
    check('categories_kind_check', sql`${t.kind} IN ('INCOME', 'EXPENSE')`),
  ],
);

/**
 * INCOME/EXPENSE reference a category. TRANSFER moves money between two own accounts in a
 * single row (both legs at once, so a transfer can never be half-saved); it has no category
 * and is excluded from income/expense analytics.
 */
export const transactions = sqliteTable(
  'transactions',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    toAccountId: text('to_account_id'),
    categoryId: text('category_id'),
    createdById: text('created_by_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: text('type', { enum: ['INCOME', 'EXPENSE', 'TRANSFER'] }).notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    toAmountMinor: integer('to_amount_minor'),
    toCurrency: text('to_currency'),
    description: text('description').notNull().default(''),
    occurredAt: text('occurred_at').notNull(),
    /**
     * Migration 0019 — the fact side of the plan. `payer_id`: the member who actually paid (may
     * differ from the owner of the planned expense). `planner_category`: planner category the
     * amount counts in for plan/fact. A planned item paid or received links its row
     * (`recurring_expense_id` / `purchase_id` / `income_source_id` + `plan_month`).
     * `is_adjustment`: a reconciliation of the balance, never income or spending.
     */
    payerId: text('payer_id'),
    plannerCategory: text('planner_category'),
    recurringExpenseId: text('recurring_expense_id'),
    purchaseId: text('purchase_id'),
    incomeSourceId: text('income_source_id'),
    planMonth: text('plan_month'),
    isAdjustment: integer('is_adjustment', { mode: 'boolean' }).notNull().default(false),
    /**
     * Migration 0023 — an operation made by the system (fund deposit, reconciliation, …) keeps
     * its kind and parameters (JSON) instead of a Russian description; the client renders the
     * text in the reader's language. `description` then holds only the user's own note.
     */
    systemKind: text('system_kind'),
    systemParams: text('system_params'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'transactions_account_fk',
      columns: [t.accountId, t.workspaceId],
      foreignColumns: [accounts.id, accounts.workspaceId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transactions_to_account_fk',
      columns: [t.toAccountId, t.workspaceId],
      foreignColumns: [accounts.id, accounts.workspaceId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'transactions_category_fk',
      columns: [t.categoryId, t.workspaceId],
      foreignColumns: [categories.id, categories.workspaceId],
    }).onDelete('restrict'),
    index('transactions_workspace_occurred_idx').on(t.workspaceId, t.occurredAt),
    index('transactions_workspace_account_idx').on(t.workspaceId, t.accountId),
    index('transactions_workspace_to_account_idx').on(t.workspaceId, t.toAccountId),
    index('transactions_workspace_category_idx').on(t.workspaceId, t.categoryId),
    index('transactions_workspace_plan_idx').on(t.workspaceId, t.planMonth),
    check('transactions_type_check', sql`${t.type} IN ('INCOME', 'EXPENSE', 'TRANSFER')`),
    check('transactions_amount_positive', sql`${t.amountMinor} > 0`),
    check(
      'transactions_to_amount_positive',
      sql`${t.toAmountMinor} IS NULL OR ${t.toAmountMinor} > 0`,
    ),
    check('transactions_currency_check', isCurrency('"currency"')),
    check(
      'transactions_occurred_at_check',
      sql.raw(`"occurred_at" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'`),
    ),
    check(
      'transactions_shape',
      sql.raw(`("type" = 'TRANSFER'
        AND "to_account_id" IS NOT NULL
        AND "to_account_id" <> "account_id"
        AND "to_amount_minor" IS NOT NULL
        AND "to_currency" IS NOT NULL
        AND "category_id" IS NULL)
      OR ("type" IN ('INCOME', 'EXPENSE')
        AND "to_account_id" IS NULL
        AND "to_amount_minor" IS NULL
        AND "to_currency" IS NULL
        AND "category_id" IS NOT NULL)`),
    ),
  ],
);

export const monthlyBudgets = sqliteTable(
  'monthly_budgets',
  {
    id: id(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').notNull(),
    month: text('month').notNull(),
    currency: text('currency').notNull(),
    limitMinor: integer('limit_minor').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'monthly_budgets_category_fk',
      columns: [t.categoryId, t.workspaceId],
      foreignColumns: [categories.id, categories.workspaceId],
    }).onDelete('cascade'),
    unique('monthly_budgets_unique').on(t.workspaceId, t.categoryId, t.month, t.currency),
    index('monthly_budgets_workspace_month_idx').on(t.workspaceId, t.month),
    check('monthly_budgets_limit_positive', sql`${t.limitMinor} > 0`),
    check('monthly_budgets_currency_check', isCurrency('"currency"')),
    check(
      'monthly_budgets_month_format',
      sql.raw(
        `"month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("month", 6, 2) BETWEEN '01' AND '12'`,
      ),
    ),
  ],
);

/**
 * Migration 0023 — idempotent writes: a retried request with the same `Idempotency-Key` gets the
 * first response back instead of writing again (see lib/idempotency.ts). Kept for a day.
 */
export const idempotencyKeys = sqliteTable(
  'idempotency_keys',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    userId: text('user_id').notNull(),
    /** METHOD and path the key was used for, and a hash of the body: reuse for another request is refused. */
    requestHash: text('request_hash').notNull(),
    status: integer('status').notNull(),
    body: text('body').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.key] }),
    index('idempotency_keys_created_idx').on(t.createdAt),
  ],
);

export const schema = {
  users,
  workspaces,
  workspaceMembers,
  sessions,
  accounts,
  categories,
  transactions,
  monthlyBudgets,
};

export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});
