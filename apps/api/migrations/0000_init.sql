CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`initial_balance_minor` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`owner_id` text,
	`color` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "accounts_type_check" CHECK("accounts"."type" IN ('CASH', 'CARD', 'BANK', 'SAVINGS', 'OTHER')),
	CONSTRAINT "accounts_currency_check" CHECK("currency" GLOB '[A-Z][A-Z][A-Z]')
);
--> statement-breakpoint
CREATE INDEX `accounts_workspace_id_idx` ON `accounts` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_id_workspace_id_unique` ON `accounts` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`system_key` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`color` text DEFAULT '#6b7280' NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "categories_kind_check" CHECK("categories"."kind" IN ('INCOME', 'EXPENSE'))
);
--> statement-breakpoint
CREATE INDEX `categories_workspace_id_idx` ON `categories` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_id_workspace_id_unique` ON `categories` (`id`,`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_workspace_id_system_key_unique` ON `categories` (`workspace_id`,`system_key`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`workspace_id` text NOT NULL,
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_created_idx` ON `idempotency_keys` (`created_at`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `monthly_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`currency` text NOT NULL,
	`limit_minor` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`,`workspace_id`) REFERENCES `categories`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "monthly_budgets_limit_positive" CHECK("monthly_budgets"."limit_minor" > 0),
	CONSTRAINT "monthly_budgets_currency_check" CHECK("currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "monthly_budgets_month_format" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("month", 6, 2) BETWEEN '01' AND '12')
);
--> statement-breakpoint
CREATE INDEX `monthly_budgets_workspace_month_idx` ON `monthly_budgets` (`workspace_id`,`month`);--> statement-breakpoint
CREATE UNIQUE INDEX `monthly_budgets_unique` ON `monthly_budgets` (`workspace_id`,`category_id`,`month`,`currency`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_token` text NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`user_agent` text,
	`ip_address` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`account_id` text NOT NULL,
	`to_account_id` text,
	`category_id` text,
	`created_by_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`to_amount_minor` integer,
	`to_currency` text,
	`description` text DEFAULT '' NOT NULL,
	`occurred_at` text NOT NULL,
	`payer_id` text,
	`planner_category` text,
	`recurring_expense_id` text,
	`purchase_id` text,
	`income_source_id` text,
	`plan_month` text,
	`is_adjustment` integer DEFAULT false NOT NULL,
	`system_kind` text,
	`system_params` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`account_id`,`workspace_id`) REFERENCES `accounts`(`id`,`workspace_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`to_account_id`,`workspace_id`) REFERENCES `accounts`(`id`,`workspace_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`category_id`,`workspace_id`) REFERENCES `categories`(`id`,`workspace_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "transactions_type_check" CHECK("transactions"."type" IN ('INCOME', 'EXPENSE', 'TRANSFER')),
	CONSTRAINT "transactions_amount_positive" CHECK("transactions"."amount_minor" > 0),
	CONSTRAINT "transactions_to_amount_positive" CHECK("transactions"."to_amount_minor" IS NULL OR "transactions"."to_amount_minor" > 0),
	CONSTRAINT "transactions_currency_check" CHECK("currency" GLOB '[A-Z][A-Z][A-Z]'),
	CONSTRAINT "transactions_occurred_at_check" CHECK("occurred_at" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
	CONSTRAINT "transactions_shape" CHECK(("type" = 'TRANSFER'
        AND "to_account_id" IS NOT NULL
        AND "to_account_id" <> "account_id"
        AND "to_amount_minor" IS NOT NULL
        AND "to_currency" IS NOT NULL
        AND "category_id" IS NULL)
      OR ("type" IN ('INCOME', 'EXPENSE')
        AND "to_account_id" IS NULL
        AND "to_amount_minor" IS NULL
        AND "to_currency" IS NULL
        AND "category_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `transactions_workspace_occurred_idx` ON `transactions` (`workspace_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_workspace_account_idx` ON `transactions` (`workspace_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `transactions_workspace_to_account_idx` ON `transactions` (`workspace_id`,`to_account_id`);--> statement-breakpoint
CREATE INDEX `transactions_workspace_category_idx` ON `transactions` (`workspace_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `transactions_workspace_plan_idx` ON `transactions` (`workspace_id`,`plan_month`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`login_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`avatar_url` text,
	`last_login_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_login_id_unique` ON `users` (`login_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workspace_members` (
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `user_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_members_role_check" CHECK("workspace_members"."role" IN ('OWNER', 'MEMBER'))
);
--> statement-breakpoint
CREATE INDEX `workspace_members_user_id_idx` ON `workspace_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_slug_unique` ON `workspaces` (`slug`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`currency` text NOT NULL,
	`effective_date` text NOT NULL,
	`rate_micros` integer NOT NULL,
	`table_no` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`currency`, `effective_date`),
	CONSTRAINT "exchange_rates_positive" CHECK("exchange_rates"."rate_micros" > 0),
	CONSTRAINT "exchange_rates_currency" CHECK("exchange_rates"."currency" IN ('EUR', 'USD', 'CAD'))
);
--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`file_name` text NOT NULL,
	`file_sha256` text NOT NULL,
	`plan_hash` text NOT NULL,
	`summary` text NOT NULL,
	`applied_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `import_batches_workspace_idx` ON `import_batches` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `income_amounts` (
	`workspace_id` text NOT NULL,
	`income_id` text NOT NULL,
	`effective_month` text NOT NULL,
	`amount_minor` integer NOT NULL,
	PRIMARY KEY(`income_id`, `effective_month`),
	FOREIGN KEY (`income_id`,`workspace_id`) REFERENCES `income_sources`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "income_amounts_month" CHECK("effective_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("effective_month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "income_amounts_non_negative" CHECK("income_amounts"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE `income_deductions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`income_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`rate_bp` integer,
	`base` text DEFAULT 'GROSS' NOT NULL,
	`amount_minor` integer,
	`currency` text,
	`start_month` text,
	`end_month` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`income_id`,`workspace_id`) REFERENCES `income_sources`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "income_deductions_shape" CHECK(("kind" = 'PERCENT' AND "rate_bp" BETWEEN 0 AND 10000 AND "amount_minor" IS NULL
          AND "currency" IS NULL AND "base" IN ('GROSS', 'REMAINDER'))
        OR ("kind" = 'FIXED' AND "amount_minor" >= 0 AND "rate_bp" IS NULL AND "base" = 'GROSS'
          AND ("currency" IS NULL OR "currency" IN ('PLN', 'EUR', 'USD', 'CAD')))),
	CONSTRAINT "income_deductions_start" CHECK("start_month" IS NULL OR ("start_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("start_month", 6, 2) BETWEEN '01' AND '12')),
	CONSTRAINT "income_deductions_end" CHECK("end_month" IS NULL OR ("end_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("end_month", 6, 2) BETWEEN '01' AND '12')),
	CONSTRAINT "income_deductions_period" CHECK("start_month" IS NULL OR "end_month" IS NULL OR "end_month" >= "start_month")
);
--> statement-breakpoint
CREATE INDEX `income_deductions_income_idx` ON `income_deductions` (`income_id`);--> statement-breakpoint
CREATE TABLE `income_overrides` (
	`workspace_id` text NOT NULL,
	`income_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_minor` integer,
	`skipped` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`income_id`, `month`),
	FOREIGN KEY (`income_id`,`workspace_id`) REFERENCES `income_sources`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "income_overrides_month" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "income_overrides_value" CHECK("income_overrides"."skipped" = 1 OR ("income_overrides"."amount_minor" IS NOT NULL AND "income_overrides"."amount_minor" >= 0))
);
--> statement-breakpoint
CREATE TABLE `income_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`owner_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`source_key` text,
	`import_batch_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "income_sources_kind" CHECK("income_sources"."kind" IN ('SALARY', 'BUSINESS', 'BENEFIT', 'OTHER')),
	CONSTRAINT "income_sources_currency" CHECK("currency" IN ('PLN', 'EUR', 'USD', 'CAD')),
	CONSTRAINT "income_sources_start" CHECK("start_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("start_month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "income_sources_end" CHECK("end_month" IS NULL OR ("end_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("end_month", 6, 2) BETWEEN '01' AND '12')),
	CONSTRAINT "income_sources_period" CHECK("end_month" IS NULL OR "end_month" >= "start_month")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `income_sources_source_key_unique` ON `income_sources` (`workspace_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `income_sources_workspace_idx` ON `income_sources` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `income_sources_id_workspace_unique` ON `income_sources` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `month_plans` (
	`workspace_id` text NOT NULL,
	`month` text NOT NULL,
	`savings_rate_bp` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `month`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "month_plans_month" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "month_plans_rate" CHECK("month_plans"."savings_rate_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE `planner_settings` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`base_currency` text DEFAULT 'PLN' NOT NULL,
	`default_savings_rate_bp` integer DEFAULT 2000 NOT NULL,
	`min_free_minor` integer DEFAULT 0 NOT NULL,
	`savings_mode` text DEFAULT 'RATE' NOT NULL,
	`joint_split` text DEFAULT 'EQUAL' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "planner_settings_base_currency" CHECK("planner_settings"."base_currency" IN ('PLN', 'EUR')),
	CONSTRAINT "planner_settings_rate" CHECK("planner_settings"."default_savings_rate_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE TABLE `planner_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `purchase_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`purchase_id` text NOT NULL,
	`type` text NOT NULL,
	`from_month` text,
	`to_month` text,
	`amount_minor` integer,
	`currency` text,
	`event_date` text,
	`created_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`purchase_id`,`workspace_id`) REFERENCES `purchases`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "purchase_events_type" CHECK("type" IN ('CREATED', 'UPDATED', 'RESCHEDULED', 'PURCHASED', 'UNPURCHASED',
        'CANCELLED', 'RESTORED'))
);
--> statement-breakpoint
CREATE INDEX `purchase_events_purchase_idx` ON `purchase_events` (`purchase_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `purchases` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`priority` text NOT NULL,
	`currency` text NOT NULL,
	`estimated_amount_minor` integer NOT NULL,
	`planned_month` text,
	`status` text NOT NULL,
	`purchased_on` text,
	`actual_amount_minor` integer,
	`note` text DEFAULT '' NOT NULL,
	`owner_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`source_key` text,
	`import_batch_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "purchases_category" CHECK("category" IN ('HOME', 'ELECTRONICS', 'CLOTHING', 'HEALTH', 'TRAVEL', 'EDUCATION',
        'GIFTS', 'TRANSPORT', 'HOBBY', 'OTHER')),
	CONSTRAINT "purchases_priority" CHECK("purchases"."priority" IN ('HIGH', 'MEDIUM', 'LOW')),
	CONSTRAINT "purchases_currency" CHECK("currency" IN ('PLN', 'EUR', 'USD', 'CAD')),
	CONSTRAINT "purchases_estimate" CHECK("purchases"."estimated_amount_minor" >= 0),
	CONSTRAINT "purchases_planned_month" CHECK("planned_month" IS NULL OR ("planned_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("planned_month", 6, 2) BETWEEN '01' AND '12')),
	CONSTRAINT "purchases_status_shape" CHECK(("status" = 'PURCHASED' AND "actual_amount_minor" >= 0
          AND ("purchased_on" IS NOT NULL OR "planned_month" IS NOT NULL))
        OR ("status" IN ('ACTIVE', 'CANCELLED') AND "purchased_on" IS NULL AND "actual_amount_minor" IS NULL)),
	CONSTRAINT "purchases_purchased_on" CHECK("purchased_on" IS NULL OR "purchased_on" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_source_key_unique` ON `purchases` (`workspace_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `purchases_workspace_planned_idx` ON `purchases` (`workspace_id`,`planned_month`);--> statement-breakpoint
CREATE INDEX `purchases_workspace_status_idx` ON `purchases` (`workspace_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `purchases_id_workspace_unique` ON `purchases` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `recurring_amounts` (
	`workspace_id` text NOT NULL,
	`expense_id` text NOT NULL,
	`effective_month` text NOT NULL,
	`amount_minor` integer NOT NULL,
	PRIMARY KEY(`expense_id`, `effective_month`),
	FOREIGN KEY (`expense_id`,`workspace_id`) REFERENCES `recurring_expenses`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_amounts_month" CHECK("effective_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("effective_month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "recurring_amounts_non_negative" CHECK("recurring_amounts"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`is_required` integer DEFAULT false NOT NULL,
	`is_ongoing` integer DEFAULT false NOT NULL,
	`ongoing_start_day` integer,
	`ongoing_end_day` integer,
	`is_loan` integer DEFAULT false NOT NULL,
	`loan_total_minor` integer,
	`category` text NOT NULL,
	`currency` text NOT NULL,
	`interval_months` integer DEFAULT 1 NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text,
	`due_day` integer,
	`note` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`owner_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`source_key` text,
	`import_batch_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_expenses_category" CHECK("category" IN ('HOUSING', 'UTILITIES', 'FOOD', 'SUBSCRIPTIONS', 'COMMUNICATION',
        'EDUCATION', 'INSTALLMENTS', 'INSURANCE', 'TRANSPORT', 'HEALTH', 'CHILDREN', 'SERVICES',
        'OTHER')),
	CONSTRAINT "recurring_expenses_currency" CHECK("currency" IN ('PLN', 'EUR', 'USD', 'CAD')),
	CONSTRAINT "recurring_expenses_required" CHECK("recurring_expenses"."is_required" IN (0, 1)),
	CONSTRAINT "recurring_expenses_ongoing" CHECK("recurring_expenses"."is_ongoing" IN (0, 1)),
	CONSTRAINT "recurring_expenses_ongoing_start" CHECK("recurring_expenses"."ongoing_start_day" IS NULL OR "recurring_expenses"."ongoing_start_day" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_expenses_ongoing_end" CHECK("recurring_expenses"."ongoing_end_day" IS NULL OR "recurring_expenses"."ongoing_end_day" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_expenses_loan" CHECK("recurring_expenses"."is_loan" IN (0, 1)),
	CONSTRAINT "recurring_expenses_loan_total" CHECK("recurring_expenses"."loan_total_minor" IS NULL OR "recurring_expenses"."loan_total_minor" > 0),
	CONSTRAINT "recurring_expenses_interval" CHECK("recurring_expenses"."interval_months" BETWEEN 1 AND 12),
	CONSTRAINT "recurring_expenses_due_day" CHECK("recurring_expenses"."due_day" IS NULL OR "recurring_expenses"."due_day" BETWEEN 1 AND 31),
	CONSTRAINT "recurring_expenses_start" CHECK("start_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("start_month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "recurring_expenses_end" CHECK("end_month" IS NULL OR ("end_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("end_month", 6, 2) BETWEEN '01' AND '12')),
	CONSTRAINT "recurring_expenses_period" CHECK("end_month" IS NULL OR "end_month" >= "start_month")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_expenses_source_key_unique` ON `recurring_expenses` (`workspace_id`,`source_key`);--> statement-breakpoint
CREATE INDEX `recurring_expenses_workspace_idx` ON `recurring_expenses` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_expenses_id_workspace_unique` ON `recurring_expenses` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `recurring_overrides` (
	`workspace_id` text NOT NULL,
	`expense_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_minor` integer,
	`skipped` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`expense_id`, `month`),
	FOREIGN KEY (`expense_id`,`workspace_id`) REFERENCES `recurring_expenses`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_overrides_month" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "recurring_overrides_value" CHECK("recurring_overrides"."skipped" = 1 OR ("recurring_overrides"."amount_minor" IS NOT NULL AND "recurring_overrides"."amount_minor" >= 0))
);
--> statement-breakpoint
CREATE TABLE `recurring_payments` (
	`workspace_id` text NOT NULL,
	`expense_id` text NOT NULL,
	`month` text NOT NULL,
	`paid` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`expense_id`, `month`),
	FOREIGN KEY (`expense_id`,`workspace_id`) REFERENCES `recurring_expenses`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_payments_month" CHECK("month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("month", 6, 2) BETWEEN '01' AND '12'),
	CONSTRAINT "recurring_payments_paid" CHECK("recurring_payments"."paid" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`dashboard_layout` text NOT NULL,
	`base_currency` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`language` text DEFAULT 'ru' NOT NULL,
	`color_labels` integer DEFAULT true NOT NULL,
	`demo_mode` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_settings_demo_mode" CHECK("user_settings"."demo_mode" IN (0, 1)),
	CONSTRAINT "user_settings_language" CHECK("user_settings"."language" IN ('ru', 'uk')),
	CONSTRAINT "user_settings_color_labels" CHECK("user_settings"."color_labels" IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE `chore_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`chore_id` text NOT NULL,
	`user_id` text NOT NULL,
	`done_on` text NOT NULL,
	`points` integer NOT NULL,
	`on_time` integer NOT NULL,
	`prev_due_on` text,
	`prev_assignee_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chore_id`,`workspace_id`) REFERENCES `chores`(`id`,`workspace_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chore_completions_done_on" CHECK("done_on" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND date("done_on") = "done_on"),
	CONSTRAINT "chore_completions_points" CHECK("chore_completions"."points" BETWEEN 1 AND 4),
	CONSTRAINT "chore_completions_on_time" CHECK("chore_completions"."on_time" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `chore_completions_workspace_done_idx` ON `chore_completions` (`workspace_id`,`done_on`);--> statement-breakpoint
CREATE INDEX `chore_completions_chore_idx` ON `chore_completions` (`chore_id`);--> statement-breakpoint
CREATE TABLE `chores` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`area` text DEFAULT 'OTHER' NOT NULL,
	`assignee_id` text,
	`rotate` integer DEFAULT false NOT NULL,
	`interval_days` integer,
	`due_on` text,
	`effort` integer DEFAULT 1 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "chores_area" CHECK("area" IN ('KITCHEN', 'BATHROOM', 'ROOMS', 'LAUNDRY', 'SHOPPING', 'PLANTS', 'PETS',
        'REPAIRS', 'PAPERWORK', 'OTHER')),
	CONSTRAINT "chores_title" CHECK(length("chores"."title") BETWEEN 1 AND 120),
	CONSTRAINT "chores_rotate" CHECK("chores"."rotate" IN (0, 1)),
	CONSTRAINT "chores_interval" CHECK("chores"."interval_days" IS NULL OR "chores"."interval_days" BETWEEN 1 AND 365),
	CONSTRAINT "chores_effort" CHECK("chores"."effort" BETWEEN 1 AND 3),
	CONSTRAINT "chores_due_on" CHECK("due_on" IS NULL OR ("due_on" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND date("due_on") = "due_on"))
);
--> statement-breakpoint
CREATE INDEX `chores_workspace_idx` ON `chores` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chores_id_workspace_unique` ON `chores` (`id`,`workspace_id`);--> statement-breakpoint
CREATE TABLE `shopping_history` (
	`workspace_id` text NOT NULL,
	`title_key` text NOT NULL,
	`title` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`last_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `title_key`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`quantity` text DEFAULT '' NOT NULL,
	`checked` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`checked_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "shopping_items_title" CHECK(length("shopping_items"."title") BETWEEN 1 AND 80),
	CONSTRAINT "shopping_items_checked" CHECK("shopping_items"."checked" IN (0, 1))
);
--> statement-breakpoint
CREATE INDEX `shopping_items_workspace_idx` ON `shopping_items` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `asset_prices` (
	`asset` text NOT NULL,
	`price_date` text NOT NULL,
	`price_pln_micros` integer NOT NULL,
	`change_24h_bp` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`asset`, `price_date`),
	CONSTRAINT "asset_prices_positive" CHECK("asset_prices"."price_pln_micros" > 0)
);
--> statement-breakpoint
CREATE TABLE `fund_auto_amounts` (
	`workspace_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`month` text NOT NULL,
	`one_month` integer DEFAULT false NOT NULL,
	`amount_minor` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `month`, `one_month`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `fund_auto_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fund_auto_amounts_amount" CHECK("fund_auto_amounts"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE `fund_auto_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subaccount_id` text NOT NULL,
	`type` text NOT NULL,
	`day` integer NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subaccount_id`) REFERENCES `fund_subaccounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fund_auto_rules_type" CHECK("fund_auto_rules"."type" IN ('DEPOSIT', 'WITHDRAWAL')),
	CONSTRAINT "fund_auto_rules_day" CHECK("fund_auto_rules"."day" BETWEEN 1 AND 31),
	CONSTRAINT "fund_auto_rules_period" CHECK("end_month" IS NULL OR "end_month" >= "start_month")
);
--> statement-breakpoint
CREATE INDEX `fund_auto_rules_subaccount_idx` ON `fund_auto_rules` (`subaccount_id`);--> statement-breakpoint
CREATE INDEX `fund_auto_rules_workspace_idx` ON `fund_auto_rules` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `fund_part_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`subaccount_id` text NOT NULL,
	`account_id` text,
	`part_name` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `savings_pots`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `fund_part_events_pot_idx` ON `fund_part_events` (`workspace_id`,`pot_id`);--> statement-breakpoint
CREATE TABLE `fund_plan_overrides` (
	`workspace_id` text NOT NULL,
	`subaccount_id` text NOT NULL,
	`month` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`subaccount_id`, `month`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subaccount_id`) REFERENCES `fund_subaccounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fund_plan_overrides_amount" CHECK("fund_plan_overrides"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE `fund_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`subaccount_id` text NOT NULL,
	`mode` text NOT NULL,
	`amount_minor` integer,
	`percent_bp` integer,
	`percent_base` text,
	`min_minor` integer,
	`max_minor` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`start_month` text NOT NULL,
	`end_month` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subaccount_id`) REFERENCES `fund_subaccounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fund_rules_mode" CHECK("fund_rules"."mode" IN ('FIXED', 'PERCENT', 'REMAINDER')),
	CONSTRAINT "fund_rules_shape" CHECK(("mode" = 'FIXED' AND "amount_minor" >= 0)
        OR ("mode" = 'PERCENT' AND "percent_bp" BETWEEN 0 AND 10000 AND "percent_base" IN ('NET_INCOME', 'OWNER_INCOME', 'FREE'))
        OR "mode" = 'REMAINDER'),
	CONSTRAINT "fund_rules_period" CHECK("end_month" IS NULL OR "end_month" >= "start_month")
);
--> statement-breakpoint
CREATE INDEX `fund_rules_subaccount_idx` ON `fund_rules` (`subaccount_id`);--> statement-breakpoint
CREATE INDEX `fund_rules_workspace_idx` ON `fund_rules` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `fund_subaccounts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`name` text NOT NULL,
	`owner_id` text,
	`color` text,
	`account_id` text,
	`currency` text,
	`opening_minor` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `savings_pots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "fund_subaccounts_name" CHECK(length("fund_subaccounts"."name") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE INDEX `fund_subaccounts_pot_idx` ON `fund_subaccounts` (`pot_id`);--> statement-breakpoint
CREATE INDEX `fund_subaccounts_account_idx` ON `fund_subaccounts` (`account_id`);--> statement-breakpoint
CREATE INDEX `fund_subaccounts_workspace_idx` ON `fund_subaccounts` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `item_shares` (
	`workspace_id` text NOT NULL,
	`item_id` text NOT NULL,
	`member_id` text NOT NULL,
	`share_bp` integer NOT NULL,
	PRIMARY KEY(`item_id`, `member_id`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "item_shares_bp" CHECK("item_shares"."share_bp" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE INDEX `item_shares_workspace_idx` ON `item_shares` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `planner_scenarios` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`income_bp` integer NOT NULL,
	`expense_bp` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "planner_scenarios_kind" CHECK("planner_scenarios"."kind" IN ('PESSIMISTIC', 'OPTIMISTIC')),
	CONSTRAINT "planner_scenarios_income" CHECK("planner_scenarios"."income_bp" BETWEEN -10000 AND 10000),
	CONSTRAINT "planner_scenarios_expense" CHECK("planner_scenarios"."expense_bp" BETWEEN -10000 AND 10000)
);
--> statement-breakpoint
CREATE TABLE `savings_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`repay_month` text,
	`repay_expense_id` text,
	`created_by_id` text,
	`subaccount_id` text,
	`transaction_id` text,
	`auto_rule_id` text,
	`return_transaction_id` text,
	`auto_month` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `savings_pots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repay_expense_id`) REFERENCES `recurring_expenses`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "savings_movements_type" CHECK("savings_movements"."type" IN ('DEPOSIT', 'WITHDRAWAL')),
	CONSTRAINT "savings_movements_amount" CHECK("savings_movements"."amount_minor" > 0),
	CONSTRAINT "savings_movements_date" CHECK("occurred_on" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]'),
	CONSTRAINT "savings_movements_repay" CHECK("repay_month" IS NULL OR ("type" = 'WITHDRAWAL' AND "repay_month" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]' AND substr("repay_month", 6, 2) BETWEEN '01' AND '12'))
);
--> statement-breakpoint
CREATE INDEX `savings_movements_pot_idx` ON `savings_movements` (`pot_id`,`occurred_on`);--> statement-breakpoint
CREATE INDEX `savings_movements_subaccount_idx` ON `savings_movements` (`subaccount_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `savings_movements_auto_unique` ON `savings_movements` (`auto_rule_id`,`auto_month`);--> statement-breakpoint
CREATE INDEX `savings_movements_expense_idx` ON `savings_movements` (`repay_expense_id`);--> statement-breakpoint
CREATE INDEX `savings_movements_workspace_idx` ON `savings_movements` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `savings_positions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`pot_id` text NOT NULL,
	`asset` text NOT NULL,
	`symbol` text NOT NULL,
	`name` text NOT NULL,
	`image` text,
	`quantity` text NOT NULL,
	`avg_price_micros` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pot_id`) REFERENCES `savings_pots`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "savings_positions_quantity" CHECK("quantity" GLOB '[0-9]*' AND "quantity" NOT GLOB '*[^0-9.]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `savings_positions_pot_asset_unique` ON `savings_positions` (`pot_id`,`asset`);--> statement-breakpoint
CREATE INDEX `savings_positions_asset_idx` ON `savings_positions` (`asset`);--> statement-breakpoint
CREATE TABLE `savings_pots` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`currency` text NOT NULL,
	`opening_minor` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`owner_id` text,
	`target_minor` integer,
	`target_date` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`icon` text,
	`color` text,
	`description` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`exclude_from_total` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "savings_pots_name" CHECK(length("savings_pots"."name") BETWEEN 1 AND 60),
	CONSTRAINT "savings_pots_kind" CHECK("savings_pots"."kind" IN ('CASH', 'PORTFOLIO')),
	CONSTRAINT "savings_pots_currency" CHECK("savings_pots"."currency" IN ('PLN', 'EUR', 'USD', 'CAD'))
);
--> statement-breakpoint
CREATE INDEX `savings_pots_workspace_idx` ON `savings_pots` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `scenario_months` (
	`workspace_id` text NOT NULL,
	`kind` text NOT NULL,
	`month` text NOT NULL,
	`income_bp` integer NOT NULL,
	`expense_bp` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `kind`, `month`),
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "scenario_months_income" CHECK("scenario_months"."income_bp" BETWEEN -10000 AND 10000),
	CONSTRAINT "scenario_months_expense" CHECK("scenario_months"."expense_bp" BETWEEN -10000 AND 10000)
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "members_name" CHECK(length("members"."name") BETWEEN 1 AND 40),
	CONSTRAINT "members_color" CHECK("color" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
);
--> statement-breakpoint
CREATE INDEX `members_workspace_idx` ON `members` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_workspace_user_unique` ON `members` (`workspace_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `api_token_secrets` (
	`hash` text PRIMARY KEY NOT NULL,
	`token_id` text NOT NULL,
	`kind` text NOT NULL,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`token_id`) REFERENCES `api_tokens`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "api_token_secrets_kind" CHECK("api_token_secrets"."kind" IN ('personal', 'access', 'refresh'))
);
--> statement-breakpoint
CREATE INDEX `api_token_secrets_token_idx` ON `api_token_secrets` (`token_id`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`client_id` text,
	`scopes` text NOT NULL,
	`expires_at` integer,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `workspace_members`(`workspace_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `api_tokens_workspace_idx` ON `api_tokens` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `mcp_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`token_id` text NOT NULL,
	`tool` text NOT NULL,
	`ok` integer NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `workspace_members`(`workspace_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `mcp_audit_workspace_idx` ON `mcp_audit` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `oauth_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`redirect_uris` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `oauth_codes` (
	`hash` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`code_challenge` text NOT NULL,
	`workspace_id` text NOT NULL,
	`user_id` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`,`user_id`) REFERENCES `workspace_members`(`workspace_id`,`user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `oauth_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`scopes` text NOT NULL,
	`state` text,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `oauth_clients`(`id`) ON UPDATE no action ON DELETE cascade
);

-- Database invariants retained for the household ledger.
--> statement-breakpoint
CREATE TRIGGER `transactions_integrity_insert`
BEFORE INSERT ON `transactions`
BEGIN
  SELECT RAISE(ABORT, 'HH_CURRENCY_MISMATCH')
  WHERE EXISTS (SELECT 1 FROM `accounts` WHERE `id` = NEW.`account_id` AND `currency` IS NOT NEW.`currency`);
  SELECT RAISE(ABORT, 'HH_CURRENCY_MISMATCH')
  WHERE NEW.`to_account_id` IS NOT NULL
    AND EXISTS (SELECT 1 FROM `accounts` WHERE `id` = NEW.`to_account_id` AND `currency` IS NOT NEW.`to_currency`);
  SELECT RAISE(ABORT, 'HH_TRANSFER_AMOUNT')
  WHERE NEW.`type` = 'TRANSFER' AND NEW.`currency` = NEW.`to_currency` AND NEW.`to_amount_minor` <> NEW.`amount_minor`;
  SELECT RAISE(ABORT, 'HH_CATEGORY_KIND')
  WHERE NEW.`category_id` IS NOT NULL
    AND EXISTS (SELECT 1 FROM `categories` WHERE `id` = NEW.`category_id` AND `kind` <> NEW.`type`);
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_integrity_update`
BEFORE UPDATE ON `transactions`
BEGIN
  SELECT RAISE(ABORT, 'HH_CURRENCY_MISMATCH')
  WHERE EXISTS (SELECT 1 FROM `accounts` WHERE `id` = NEW.`account_id` AND `currency` IS NOT NEW.`currency`);
  SELECT RAISE(ABORT, 'HH_CURRENCY_MISMATCH')
  WHERE NEW.`to_account_id` IS NOT NULL
    AND EXISTS (SELECT 1 FROM `accounts` WHERE `id` = NEW.`to_account_id` AND `currency` IS NOT NEW.`to_currency`);
  SELECT RAISE(ABORT, 'HH_TRANSFER_AMOUNT')
  WHERE NEW.`type` = 'TRANSFER' AND NEW.`currency` = NEW.`to_currency` AND NEW.`to_amount_minor` <> NEW.`amount_minor`;
  SELECT RAISE(ABORT, 'HH_CATEGORY_KIND')
  WHERE NEW.`category_id` IS NOT NULL
    AND EXISTS (SELECT 1 FROM `categories` WHERE `id` = NEW.`category_id` AND `kind` <> NEW.`type`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE')
  WHERE NEW.`workspace_id` IS NOT OLD.`workspace_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_currency_locked`
BEFORE UPDATE OF `currency` ON `accounts`
WHEN OLD.`currency` IS NOT NEW.`currency`
  AND EXISTS (
    SELECT 1 FROM `transactions`
    WHERE `account_id` = OLD.`id` OR `to_account_id` = OLD.`id`
  )
BEGIN
  SELECT RAISE(ABORT, 'HH_ACCOUNT_HAS_TRANSACTIONS');
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `accounts`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `monthly_budgets_kind_insert`
BEFORE INSERT ON `monthly_budgets`
BEGIN
  SELECT RAISE(ABORT, 'HH_BUDGET_CATEGORY_KIND')
  WHERE EXISTS (SELECT 1 FROM `categories` WHERE `id` = NEW.`category_id` AND `kind` <> 'EXPENSE');
END;
--> statement-breakpoint
CREATE TRIGGER `monthly_budgets_kind_update`
BEFORE UPDATE OF `category_id` ON `monthly_budgets`
BEGIN
  SELECT RAISE(ABORT, 'HH_BUDGET_CATEGORY_KIND')
  WHERE EXISTS (SELECT 1 FROM `categories` WHERE `id` = NEW.`category_id` AND `kind` <> 'EXPENSE');
END;
--> statement-breakpoint
CREATE TRIGGER `income_sources_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `income_sources`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `recurring_expenses_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `recurring_expenses`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `purchases_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `purchases`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `purchase_events_append_only`
BEFORE UPDATE ON `purchase_events`
BEGIN
  SELECT RAISE(ABORT, 'HH_HISTORY_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `income_amounts_inside_period`
BEFORE INSERT ON `income_amounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_OUTSIDE_PERIOD')
  WHERE EXISTS (
    SELECT 1 FROM `income_sources` s
    WHERE s.`id` = NEW.`income_id`
      AND (NEW.`effective_month` < s.`start_month`
        OR (s.`end_month` IS NOT NULL AND NEW.`effective_month` > s.`end_month`))
  );
END;
--> statement-breakpoint
CREATE TRIGGER `recurring_amounts_inside_period`
BEFORE INSERT ON `recurring_amounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_OUTSIDE_PERIOD')
  WHERE EXISTS (
    SELECT 1 FROM `recurring_expenses` e
    WHERE e.`id` = NEW.`expense_id`
      AND (NEW.`effective_month` < e.`start_month`
        OR (e.`end_month` IS NOT NULL AND NEW.`effective_month` > e.`end_month`))
  );
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_workspace_refs_insert`
BEFORE INSERT ON `accounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_workspace_refs_update`
BEFORE UPDATE OF `owner_id`, `workspace_id` ON `accounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL AND NEW.`owner_id` IS NOT OLD.`owner_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `income_sources_workspace_refs_insert`
BEFORE INSERT ON `income_sources`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `income_sources_workspace_refs_update`
BEFORE UPDATE OF `owner_id`, `workspace_id` ON `income_sources`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL AND NEW.`owner_id` IS NOT OLD.`owner_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `recurring_expenses_workspace_refs_insert`
BEFORE INSERT ON `recurring_expenses`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `recurring_expenses_workspace_refs_update`
BEFORE UPDATE OF `owner_id`, `workspace_id` ON `recurring_expenses`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL AND NEW.`owner_id` IS NOT OLD.`owner_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `purchases_workspace_refs_insert`
BEFORE INSERT ON `purchases`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `purchases_workspace_refs_update`
BEFORE UPDATE OF `owner_id`, `workspace_id` ON `purchases`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL AND NEW.`owner_id` IS NOT OLD.`owner_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_workspace_refs_insert`
BEFORE INSERT ON `transactions`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`payer_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`payer_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`recurring_expense_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `recurring_expenses` WHERE `id` = NEW.`recurring_expense_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`purchase_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `purchases` WHERE `id` = NEW.`purchase_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`income_source_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `income_sources` WHERE `id` = NEW.`income_source_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `transactions_workspace_refs_update`
BEFORE UPDATE OF `payer_id`, `recurring_expense_id`, `purchase_id`, `income_source_id`, `workspace_id` ON `transactions`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`payer_id` IS NOT NULL AND NEW.`payer_id` IS NOT OLD.`payer_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`payer_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`recurring_expense_id` IS NOT NULL AND NEW.`recurring_expense_id` IS NOT OLD.`recurring_expense_id`
    AND NOT EXISTS (SELECT 1 FROM `recurring_expenses` WHERE `id` = NEW.`recurring_expense_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`purchase_id` IS NOT NULL AND NEW.`purchase_id` IS NOT OLD.`purchase_id`
    AND NOT EXISTS (SELECT 1 FROM `purchases` WHERE `id` = NEW.`purchase_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`income_source_id` IS NOT NULL AND NEW.`income_source_id` IS NOT OLD.`income_source_id`
    AND NOT EXISTS (SELECT 1 FROM `income_sources` WHERE `id` = NEW.`income_source_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `savings_pots_workspace_refs_insert`
BEFORE INSERT ON `savings_pots`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `savings_pots_workspace_refs_update`
BEFORE UPDATE OF `owner_id`, `workspace_id` ON `savings_pots`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL AND NEW.`owner_id` IS NOT OLD.`owner_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `savings_positions_workspace_refs_insert`
BEFORE INSERT ON `savings_positions`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`pot_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `savings_pots` WHERE `id` = NEW.`pot_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `savings_positions_workspace_refs_update`
BEFORE UPDATE OF `pot_id`, `workspace_id` ON `savings_positions`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`pot_id` IS NOT NULL AND NEW.`pot_id` IS NOT OLD.`pot_id`
    AND NOT EXISTS (SELECT 1 FROM `savings_pots` WHERE `id` = NEW.`pot_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_subaccounts_workspace_refs_insert`
BEFORE INSERT ON `fund_subaccounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`pot_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `savings_pots` WHERE `id` = NEW.`pot_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`account_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `accounts` WHERE `id` = NEW.`account_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_subaccounts_workspace_refs_update`
BEFORE UPDATE OF `pot_id`, `account_id`, `owner_id`, `workspace_id` ON `fund_subaccounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`pot_id` IS NOT NULL AND NEW.`pot_id` IS NOT OLD.`pot_id`
    AND NOT EXISTS (SELECT 1 FROM `savings_pots` WHERE `id` = NEW.`pot_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`account_id` IS NOT NULL AND NEW.`account_id` IS NOT OLD.`account_id`
    AND NOT EXISTS (SELECT 1 FROM `accounts` WHERE `id` = NEW.`account_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`owner_id` IS NOT NULL AND NEW.`owner_id` IS NOT OLD.`owner_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`owner_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `savings_movements_workspace_refs_insert`
BEFORE INSERT ON `savings_movements`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`pot_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `savings_pots` WHERE `id` = NEW.`pot_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`transaction_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `transactions` WHERE `id` = NEW.`transaction_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`return_transaction_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `transactions` WHERE `id` = NEW.`return_transaction_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`auto_rule_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `fund_auto_rules` WHERE `id` = NEW.`auto_rule_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`repay_expense_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `recurring_expenses` WHERE `id` = NEW.`repay_expense_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `savings_movements_workspace_refs_update`
BEFORE UPDATE OF `pot_id`, `subaccount_id`, `transaction_id`, `return_transaction_id`, `auto_rule_id`, `repay_expense_id`, `workspace_id` ON `savings_movements`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`pot_id` IS NOT NULL AND NEW.`pot_id` IS NOT OLD.`pot_id`
    AND NOT EXISTS (SELECT 1 FROM `savings_pots` WHERE `id` = NEW.`pot_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL AND NEW.`subaccount_id` IS NOT OLD.`subaccount_id`
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`transaction_id` IS NOT NULL AND NEW.`transaction_id` IS NOT OLD.`transaction_id`
    AND NOT EXISTS (SELECT 1 FROM `transactions` WHERE `id` = NEW.`transaction_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`return_transaction_id` IS NOT NULL AND NEW.`return_transaction_id` IS NOT OLD.`return_transaction_id`
    AND NOT EXISTS (SELECT 1 FROM `transactions` WHERE `id` = NEW.`return_transaction_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`auto_rule_id` IS NOT NULL AND NEW.`auto_rule_id` IS NOT OLD.`auto_rule_id`
    AND NOT EXISTS (SELECT 1 FROM `fund_auto_rules` WHERE `id` = NEW.`auto_rule_id` AND `workspace_id` = NEW.`workspace_id`);
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`repay_expense_id` IS NOT NULL AND NEW.`repay_expense_id` IS NOT OLD.`repay_expense_id`
    AND NOT EXISTS (SELECT 1 FROM `recurring_expenses` WHERE `id` = NEW.`repay_expense_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_rules_workspace_refs_insert`
BEFORE INSERT ON `fund_rules`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_rules_workspace_refs_update`
BEFORE UPDATE OF `subaccount_id`, `workspace_id` ON `fund_rules`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL AND NEW.`subaccount_id` IS NOT OLD.`subaccount_id`
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_plan_overrides_workspace_refs_insert`
BEFORE INSERT ON `fund_plan_overrides`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_plan_overrides_workspace_refs_update`
BEFORE UPDATE OF `subaccount_id`, `workspace_id` ON `fund_plan_overrides`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL AND NEW.`subaccount_id` IS NOT OLD.`subaccount_id`
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_auto_rules_workspace_refs_insert`
BEFORE INSERT ON `fund_auto_rules`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_auto_rules_workspace_refs_update`
BEFORE UPDATE OF `subaccount_id`, `workspace_id` ON `fund_auto_rules`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`subaccount_id` IS NOT NULL AND NEW.`subaccount_id` IS NOT OLD.`subaccount_id`
    AND NOT EXISTS (SELECT 1 FROM `fund_subaccounts` WHERE `id` = NEW.`subaccount_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_auto_amounts_workspace_refs_insert`
BEFORE INSERT ON `fund_auto_amounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`rule_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `fund_auto_rules` WHERE `id` = NEW.`rule_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `fund_auto_amounts_workspace_refs_update`
BEFORE UPDATE OF `rule_id`, `workspace_id` ON `fund_auto_amounts`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`rule_id` IS NOT NULL AND NEW.`rule_id` IS NOT OLD.`rule_id`
    AND NOT EXISTS (SELECT 1 FROM `fund_auto_rules` WHERE `id` = NEW.`rule_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `item_shares_workspace_refs_insert`
BEFORE INSERT ON `item_shares`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`member_id` IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`member_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `item_shares_workspace_refs_update`
BEFORE UPDATE OF `member_id`, `workspace_id` ON `item_shares`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_MISMATCH')
  WHERE NEW.`member_id` IS NOT NULL AND NEW.`member_id` IS NOT OLD.`member_id`
    AND NOT EXISTS (SELECT 1 FROM `members` WHERE `id` = NEW.`member_id` AND `workspace_id` = NEW.`workspace_id`);
END;
--> statement-breakpoint
CREATE TRIGGER `savings_pots_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `savings_pots`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `savings_positions_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `savings_positions`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `savings_movements_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `savings_movements`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `fund_subaccounts_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `fund_subaccounts`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `fund_rules_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `fund_rules`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `fund_plan_overrides_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `fund_plan_overrides`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `fund_auto_rules_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `fund_auto_rules`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `fund_auto_amounts_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `fund_auto_amounts`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `item_shares_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `item_shares`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `scenario_months_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `scenario_months`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `planner_scenarios_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `planner_scenarios`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `members_workspace_immutable`
BEFORE UPDATE OF `workspace_id` ON `members`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `income_sources_delete_shares`
AFTER DELETE ON `income_sources`
BEGIN
  DELETE FROM `item_shares` WHERE `item_id` = OLD.`id` AND `workspace_id` = OLD.`workspace_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `recurring_expenses_delete_shares`
AFTER DELETE ON `recurring_expenses`
BEGIN
  DELETE FROM `item_shares` WHERE `item_id` = OLD.`id` AND `workspace_id` = OLD.`workspace_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `purchases_delete_shares`
AFTER DELETE ON `purchases`
BEGIN
  DELETE FROM `item_shares` WHERE `item_id` = OLD.`id` AND `workspace_id` = OLD.`workspace_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `accounts_delete_fund_parts`
AFTER DELETE ON `accounts`
BEGIN
  UPDATE `fund_subaccounts` SET `account_id` = NULL
  WHERE `account_id` = OLD.`id` AND `workspace_id` = OLD.`workspace_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `api_tokens_workspace_immutable`
BEFORE UPDATE OF `workspace_id`, `user_id` ON `api_tokens`
WHEN NEW.`workspace_id` IS NOT OLD.`workspace_id` OR NEW.`user_id` IS NOT OLD.`user_id`
BEGIN
  SELECT RAISE(ABORT, 'HH_WORKSPACE_IMMUTABLE');
END;
--> statement-breakpoint
CREATE TRIGGER `mcp_audit_append_only`
BEFORE UPDATE ON `mcp_audit`
BEGIN
  SELECT RAISE(ABORT, 'HH_APPEND_ONLY');
END;

--> statement-breakpoint
CREATE VIEW `batch_guard` AS SELECT 1 AS `ok`;
--> statement-breakpoint
CREATE TRIGGER `batch_guard_check`
INSTEAD OF INSERT ON `batch_guard`
WHEN NOT NEW.`ok`
BEGIN
  SELECT RAISE(ABORT, 'HH_GUARD_FAILED');
END;