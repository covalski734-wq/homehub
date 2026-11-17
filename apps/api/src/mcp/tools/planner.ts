import {
  amountChangeSchema,
  deductionCreateSchema,
  deductionUpdateSchema,
  idSchema,
  incomeCreateSchema,
  incomeReceiptSchema,
  incomeUpdateSchema,
  itemSharesSchema,
  monthPlanUpdateSchema,
  monthSchema,
  plannerSettingsUpdateSchema,
  purchaseCompleteSchema,
  purchaseCreateSchema,
  purchaseQuerySchema,
  purchaseUpdateSchema,
  recurringCreateSchema,
  recurringPaymentSchema,
  recurringUpdateSchema,
  scenarioMonthSchema,
  scenarioQuerySchema,
  scenarioUpdateSchema,
  skipMonthSchema,
  stopFromMonthSchema,
  versionOnlySchema,
} from '@homehub/shared';
import { z } from 'zod';
import { currentMonth } from '../../lib/dates';
import type { ToolEnv } from '../tool';
import { defineTool } from '../tool';

/** Totals are shown in the display currency of the member who asks, as in the app. */
const planner = ({ ctx, services }: ToolEnv) => services.planner.forViewer(ctx.userId);
const scenarios = ({ ctx, services }: ToolEnv) => services.scenarios.forViewer(ctx.userId);

/** The month the answer describes the line in (the app's view month); the current one by default. */
const viewMonth = monthSchema.optional();
const inMonth = (month: string | undefined) => month ?? currentMonth();

/** Planned incomes, deductions, regular payments, loans, purchases, rates and scenarios. */
export const plannerTools = [
  defineTool({
    name: 'planner_get_settings',
    title: 'Настройки плана',
    description:
      'Planner settings: base currency, default savings rate (%), minimum kept free, how joint lines are split and the savings mode.',
    scope: 'planner:read',
    input: z.object({}),
    run: (env) => planner(env).settings(env.ctx.workspaceId),
  }),
  defineTool({
    name: 'planner_update_settings',
    title: 'Изменить настройки плана',
    description:
      'Changes planner settings (only the fields sent). A new default savings rate applies from the current month; past months keep theirs.',
    scope: 'planner:write',
    input: z.object({ data: plannerSettingsUpdateSchema }),
    annotations: { idempotent: true },
    run: (env, { data }) => planner(env).updateSettings(env.ctx.workspaceId, data),
  }),
  defineTool({
    name: 'planner_month_budget',
    title: 'План месяца',
    description:
      'The plan of a month ("YYYY-MM"): incomes, deductions, regular payments, purchases, savings and the free remainder, with totals in the base currency.',
    scope: 'planner:read',
    input: z.object({ month: monthSchema }),
    run: (env, { month }) => planner(env).monthBudget(env.ctx.workspaceId, month),
  }),
  defineTool({
    name: 'planner_set_savings_rate',
    title: 'Норма сбережений месяца',
    description:
      'Sets the savings rate (percent, decimal string) of one month; null returns the month to the default rate.',
    scope: 'planner:write',
    input: z.object({ month: monthSchema, data: monthPlanUpdateSchema }),
    annotations: { idempotent: true },
    run: (env, { month, data }) =>
      planner(env).setSavingsRate(env.ctx.workspaceId, month, data.savingsRate),
  }),
  defineTool({
    name: 'planner_trend',
    title: 'Динамика плана',
    description:
      'Planned income, expenses and savings for the `months` (1–24, default 12) months ending with `to` ("YYYY-MM").',
    scope: 'planner:read',
    input: z.object({ to: monthSchema, months: z.number().int().min(1).max(24).default(12) }),
    run: (env, { to, months }) => planner(env).trend(env.ctx.workspaceId, to, months),
  }),

  // ---- incomes and deductions ----
  defineTool({
    name: 'planner_list_incomes',
    title: 'Доходы',
    description:
      'Planned income sources as seen in a month (default: current): amount, deductions, net, receipt; each with its version for updates.',
    scope: 'planner:read',
    input: z.object({ month: viewMonth }),
    run: (env, { month }) => planner(env).incomes(env.ctx.workspaceId, inMonth(month)),
  }),
  defineTool({
    name: 'planner_create_income',
    title: 'Добавить доход',
    description:
      'Adds a planned income source (amount is a decimal string, months "YYYY-MM"); the answer shows it in `month` (default: current).',
    scope: 'planner:write',
    input: z.object({ data: incomeCreateSchema, month: viewMonth }),
    run: (env, { data, month }) =>
      planner(env).createIncome(env.ctx.workspaceId, data, inMonth(month)),
  }),
  defineTool({
    name: 'planner_update_income',
    title: 'Изменить доход',
    description:
      'Changes an income source (name, kind, currency, months, owner); needs the row version from the list. Amounts change with planner_set_income_amount.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: incomeUpdateSchema, month: viewMonth }),
    annotations: { idempotent: true },
    run: (env, { id, data, month }) =>
      planner(env).updateIncome(env.ctx.workspaceId, id, data, inMonth(month)),
  }),
  defineTool({
    name: 'planner_set_income_amount',
    title: 'Сумма дохода',
    description:
      'Sets the amount of an income from a month: for that month only (scope MONTH) or from it on; earlier months keep theirs.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: amountChangeSchema }),
    annotations: { idempotent: true },
    run: (env, { id, data }) => planner(env).setAmount('income', env.ctx.workspaceId, id, data),
  }),
  defineTool({
    name: 'planner_skip_income',
    title: 'Пропустить доход в месяце',
    description: 'Skips an income in one month (skipped: true) or brings it back (false).',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: skipMonthSchema }),
    annotations: { idempotent: true },
    run: (env, { id, data }) =>
      planner(env).setSkipped('income', env.ctx.workspaceId, id, data.month, data.skipped),
  }),
  defineTool({
    name: 'planner_stop_income',
    title: 'Остановить доход',
    description:
      'Ends an income from a month on; earlier months keep it (history is never rewritten). Stopping at (or before) its first month deletes it.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: stopFromMonthSchema }),
    annotations: { destructive: true },
    run: (env, { id, data }) =>
      planner(env).stopFrom('income', env.ctx.workspaceId, id, data.month),
  }),
  defineTool({
    name: 'planner_receive_income',
    title: 'Доход получен',
    description:
      'Legacy account bookkeeping: records an income operation on an account. Do not use for normal salary entry: household planning only needs the income amount and month, without an account. Use this tool only when the user explicitly asks to create an account operation.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: incomeReceiptSchema }),
    run: (env, { id, data }) =>
      planner(env).receiveIncome(env.ctx.workspaceId, env.ctx.userId, id, data),
  }),
  defineTool({
    name: 'planner_unreceive_income',
    title: 'Отменить получение дохода',
    description: 'Removes the receipt of an income in a month together with its income operation.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, month: monthSchema }),
    annotations: { destructive: true, idempotent: true },
    run: (env, { id, month }) => planner(env).unreceiveIncome(env.ctx.workspaceId, id, month),
  }),
  defineTool({
    name: 'planner_create_deduction',
    title: 'Добавить вычет',
    description:
      'Adds a deduction (tax, contribution …) to an income: a percent rate of gross/net or a fixed amount; the answer is the income in `month`.',
    scope: 'planner:write',
    input: z.object({ incomeId: idSchema, data: deductionCreateSchema, month: viewMonth }),
    run: (env, { incomeId, data, month }) =>
      planner(env).createDeduction(env.ctx.workspaceId, incomeId, data, inMonth(month)),
  }),
  defineTool({
    name: 'planner_update_deduction',
    title: 'Изменить вычет',
    description: 'Changes a deduction of an income; needs its version from the income list.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: deductionUpdateSchema, month: viewMonth }),
    annotations: { idempotent: true },
    run: (env, { id, data, month }) =>
      planner(env).updateDeduction(env.ctx.workspaceId, id, data, inMonth(month)),
  }),
  defineTool({
    name: 'planner_delete_deduction',
    title: 'Удалить вычет',
    description: 'Deletes a deduction of an income.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, month: viewMonth }),
    annotations: { destructive: true, idempotent: true },
    run: (env, { id, month }) =>
      planner(env).deleteDeduction(env.ctx.workspaceId, id, inMonth(month)),
  }),
  defineTool({
    name: 'planner_set_shares',
    title: 'Доли участников',
    description:
      "Sets the members' own shares (percent) of a joint income, regular payment or purchase; they add up to 100. An empty list returns the household default split.",
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: itemSharesSchema }),
    annotations: { idempotent: true },
    run: (env, { id, data }) => planner(env).setShares(env.ctx.workspaceId, id, data.shares),
  }),

  // ---- regular payments and loans ----
  defineTool({
    name: 'planner_list_recurring',
    title: 'Регулярные платежи',
    description:
      'Regular payments (bills, subscriptions, loans, fund contributions) as seen in a month (default: current), with paid marks and versions.',
    scope: 'planner:read',
    input: z.object({ month: viewMonth }),
    run: (env, { month }) => planner(env).recurring(env.ctx.workspaceId, inMonth(month)),
  }),
  defineTool({
    name: 'planner_list_loans',
    title: 'Кредиты',
    description:
      'Loans among the regular payments and their repayment progress as of a month (default: current).',
    scope: 'planner:read',
    input: z.object({ month: viewMonth }),
    run: (env, { month }) => planner(env).loans(env.ctx.workspaceId, inMonth(month)),
  }),
  defineTool({
    name: 'planner_create_recurring',
    title: 'Добавить регулярный платеж',
    description:
      'Adds a regular payment (amount is a decimal string, months "YYYY-MM"); the answer shows it in `month` (default: current).',
    scope: 'planner:write',
    input: z.object({ data: recurringCreateSchema, month: viewMonth }),
    run: (env, { data, month }) =>
      planner(env).createRecurring(env.ctx.workspaceId, data, inMonth(month)),
  }),
  defineTool({
    name: 'planner_update_recurring',
    title: 'Изменить регулярный платеж',
    description:
      'Changes a regular payment (name, category, currency, months, owner, loan total); needs the row version from the list. Amounts change with planner_set_recurring_amount.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: recurringUpdateSchema, month: viewMonth }),
    annotations: { idempotent: true },
    run: (env, { id, data, month }) =>
      planner(env).updateRecurring(env.ctx.workspaceId, id, data, inMonth(month)),
  }),
  defineTool({
    name: 'planner_set_recurring_amount',
    title: 'Сумма платежа',
    description:
      'Sets the amount of a regular payment from a month: for that month only (scope MONTH) or from it on; earlier months keep theirs.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: amountChangeSchema }),
    annotations: { idempotent: true },
    run: (env, { id, data }) => planner(env).setAmount('recurring', env.ctx.workspaceId, id, data),
  }),
  defineTool({
    name: 'planner_skip_recurring',
    title: 'Пропустить платеж в месяце',
    description: 'Skips a regular payment in one month (skipped: true) or brings it back (false).',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: skipMonthSchema }),
    annotations: { idempotent: true },
    run: (env, { id, data }) =>
      planner(env).setSkipped('recurring', env.ctx.workspaceId, id, data.month, data.skipped),
  }),
  defineTool({
    name: 'planner_stop_recurring',
    title: 'Остановить платеж',
    description:
      'Ends a regular payment from a month on; earlier months keep it (history is never rewritten). Stopping at (or before) its first month deletes it.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: stopFromMonthSchema }),
    annotations: { destructive: true },
    run: (env, { id, data }) =>
      planner(env).stopFrom('recurring', env.ctx.workspaceId, id, data.month),
  }),
  defineTool({
    name: 'planner_set_recurring_paid',
    title: 'Отметить оплату',
    description:
      'Marks a regular payment paid or unpaid in a month. For everyday household tracking omit actual: this is only a checkmark, with no account or savings movement. Do not ask for an account. The optional actual field is legacy bookkeeping and must only be used if the user explicitly requests an account operation.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: recurringPaymentSchema }),
    run: (env, { id, data }) =>
      planner(env).setPaid(
        env.ctx.workspaceId,
        id,
        data.month,
        data.paid,
        data.actual,
        env.ctx.userId,
      ),
  }),

  // ---- purchases ----
  defineTool({
    name: 'planner_list_purchases',
    title: 'Покупки',
    description:
      'Planned purchases (wishlist), optionally filtered by status (ACTIVE, PURCHASED, CANCELLED) and planned month; each with its version.',
    scope: 'planner:read',
    input: z.object({ query: purchaseQuerySchema.optional() }),
    run: (env, { query }) => planner(env).purchases(env.ctx.workspaceId, query ?? {}),
  }),
  defineTool({
    name: 'planner_create_purchase',
    title: 'Добавить покупку',
    description:
      'Adds a planned purchase with its estimated amount (decimal string) and optional planned month ("YYYY-MM").',
    scope: 'planner:write',
    input: z.object({ data: purchaseCreateSchema }),
    run: (env, { data }) => planner(env).createPurchase(env.ctx.workspaceId, env.ctx.userId, data),
  }),
  defineTool({
    name: 'planner_update_purchase',
    title: 'Изменить покупку',
    description:
      'Changes a planned purchase (only the fields sent); needs its version from the list. Changes are kept in its history.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: purchaseUpdateSchema }),
    annotations: { idempotent: true },
    run: (env, { id, data }) =>
      planner(env).updatePurchase(env.ctx.workspaceId, env.ctx.userId, id, data),
  }),
  defineTool({
    name: 'planner_complete_purchase',
    title: 'Покупка сделана',
    description:
      'Marks a purchase bought with its actual amount and date. Omit accountId and payerId for normal household tracking: buying does not move account or savings balances. Do not ask for an account. Needs the version. Account fields are legacy bookkeeping, only for an explicitly requested account operation.',
    scope: 'planner:write',
    input: z.object({ id: idSchema, data: purchaseCompleteSchema }),
    run: (env, { id, data }) =>
      planner(env).completePurchase(env.ctx.workspaceId, env.ctx.userId, id, data),
  }),
  defineTool({
    name: 'planner_set_purchase_status',
    title: 'Статус покупки',
    description:
      'unpurchase — a bought purchase becomes active again (its expense operation is removed); cancel — an active one is cancelled; restore — a cancelled one is active again. Needs the version.',
    scope: 'planner:write',
    input: z.object({
      id: idSchema,
      action: z.enum(['unpurchase', 'cancel', 'restore']),
      data: versionOnlySchema,
    }),
    run: (env, { id, action, data }) =>
      planner(env).setPurchaseStatus(env.ctx.workspaceId, env.ctx.userId, id, data.version, action),
  }),
  defineTool({
    name: 'planner_delete_purchase',
    title: 'Удалить покупку',
    description:
      'Deletes a planned purchase with its history. A bought purchase cannot be deleted.',
    scope: 'planner:write',
    input: z.object({ id: idSchema }),
    annotations: { destructive: true, idempotent: true },
    run: (env, { id }) => planner(env).deletePurchase(env.ctx.workspaceId, id),
  }),
  defineTool({
    name: 'planner_purchase_history',
    title: 'История покупки',
    description:
      'The history of a purchase: created, changed, rescheduled, bought, cancelled — who and when.',
    scope: 'planner:read',
    input: z.object({ id: idSchema }),
    run: (env, { id }) => planner(env).purchaseHistory(env.ctx.workspaceId, id),
  }),

  // ---- exchange rates ----
  defineTool({
    name: 'planner_rates_status',
    title: 'Курсы валют',
    description:
      'The NBP exchange rates used to convert plan amounts, when they were last loaded, the last error and whether they are stale.',
    scope: 'planner:read',
    input: z.object({}),
    run: (env) => planner(env).ratesStatus(),
  }),
  defineTool({
    name: 'planner_refresh_rates',
    title: 'Обновить курсы',
    description: 'Loads missing NBP exchange rates now (normally done by the daily job).',
    scope: 'planner:write',
    input: z.object({}),
    annotations: { idempotent: true },
    run: (env) => planner(env).refreshRates(),
  }),

  // ---- savings scenarios ----
  defineTool({
    name: 'savings_get_scenarios',
    title: 'Сценарии накоплений',
    description:
      'Pessimistic and optimistic savings forecasts for `months` (1–36, default 12) months from `from` ("YYYY-MM"), with the percentages each month uses.',
    scope: 'savings:read',
    input: scenarioQuerySchema,
    run: (env, { from, months }) => scenarios(env).compute(env.ctx.workspaceId, from, months),
  }),
  defineTool({
    name: 'savings_update_scenario',
    title: 'Изменить сценарий',
    description:
      'Sets the default income and expense change (signed percent) of the PESSIMISTIC or OPTIMISTIC scenario.',
    scope: 'savings:write',
    input: z.object({ data: scenarioUpdateSchema }),
    annotations: { idempotent: true },
    run: (env, { data }) => scenarios(env).update(env.ctx.workspaceId, data),
  }),
  defineTool({
    name: 'savings_set_scenario_month',
    title: 'Сценарий месяца',
    description:
      "Sets a scenario's own income and expense percentages for one month; null percentages return the month to the scenario default.",
    scope: 'savings:write',
    input: z.object({ data: scenarioMonthSchema }),
    annotations: { idempotent: true },
    run: (env, { data }) => scenarios(env).setMonth(env.ctx.workspaceId, data),
  }),
];
