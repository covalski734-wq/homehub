import {
  accountCreateSchema,
  accountTopupSchema,
  accountUpdateSchema,
  budgetCopySchema,
  budgetQuerySchema,
  budgetUpsertSchema,
  idSchema,
  reconcileSchema,
  summaryQuerySchema,
  transactionInputSchema,
  transactionQuerySchema,
} from '@homehub/shared';
import { z } from 'zod';
import { defineTool } from '../tool';

const byId = z.object({ id: idSchema });

/** Accounts, operations, categories, monthly limits and the month summary. */
export const financeTools = [
  defineTool({
    name: 'finance_list_accounts',
    title: 'Счета',
    description:
      'All accounts with their computed balance, currency, owner, archive flag and the part of the balance reserved by funds (available = balance − reserved).',
    scope: 'finance:read',
    input: z.object({}),
    run: ({ ctx, services }) => services.accounts.list(ctx.workspaceId),
  }),
  defineTool({
    name: 'finance_account_totals',
    title: 'Итоги по счетам',
    description: 'The sum of account balances per currency (currencies are never added together).',
    scope: 'finance:read',
    input: z.object({}),
    run: ({ ctx, services }) => services.accounts.totals(ctx.workspaceId),
  }),
  defineTool({
    name: 'finance_create_account',
    title: 'Создать счет',
    description:
      'Creates an account (card, cash, savings …) with its currency and opening balance.',
    scope: 'finance:write',
    input: z.object({ data: accountCreateSchema }),
    run: ({ ctx, services }, { data }) => services.accounts.create(ctx.workspaceId, data),
  }),
  defineTool({
    name: 'finance_update_account',
    title: 'Изменить счет',
    description:
      'Changes an account: name, type, owner, colour, note, opening balance, archive. The currency of an account with operations cannot change.',
    scope: 'finance:write',
    input: z.object({ id: idSchema, data: accountUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.accounts.update(ctx.workspaceId, id, data),
  }),
  defineTool({
    name: 'finance_top_up_account',
    title: 'Пополнить счет',
    description:
      'Puts money on an account from outside the plan (not income): it stays in the account history.',
    scope: 'finance:write',
    input: z.object({ id: idSchema, data: accountTopupSchema }),
    run: ({ ctx, services }, { id, data }) => services.accounts.topup(ctx, id, data),
  }),
  defineTool({
    name: 'finance_reconcile_account',
    title: 'Сверить остаток',
    description:
      'Sets the real balance seen in the bank: the difference becomes a reconciliation operation (never income or spending). Repeating it to the same balance adds nothing.',
    scope: 'finance:write',
    input: z.object({ id: idSchema, data: reconcileSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) =>
      services.accounts.reconcile(ctx, id, data.balance, data.date),
  }),
  defineTool({
    name: 'finance_list_categories',
    title: 'Категории',
    description: 'Income and expense categories (system ones have a systemKey).',
    scope: 'finance:read',
    input: z.object({}),
    run: async ({ ctx, services }) =>
      (await services.categories.list(ctx.workspaceId)).map(
        ({ id, name, kind, color, isSystem, systemKey }) => ({
          id,
          name,
          kind,
          color,
          isSystem,
          systemKey,
        }),
      ),
  }),
  defineTool({
    name: 'finance_list_transactions',
    title: 'Операции',
    description:
      'Operations (income, expense, transfer) with filters by month, type, account, category; paged (pageSize ≤ 100), sortable.',
    scope: 'finance:read',
    input: z.object({ query: transactionQuerySchema }),
    run: ({ ctx, services }, { query }) => services.transactions.list(ctx.workspaceId, query),
  }),
  defineTool({
    name: 'finance_create_transaction',
    title: 'Добавить операцию',
    description:
      'Adds an income, expense or transfer. The currency comes from the account; a transfer between currencies needs toAmount.',
    scope: 'finance:write',
    input: z.object({ data: transactionInputSchema }),
    run: ({ ctx, services }, { data }) => services.transactions.create(ctx, data),
  }),
  defineTool({
    name: 'finance_update_transaction',
    title: 'Изменить операцию',
    description:
      'Replaces an operation completely (send every field). Operations made by a fund are changed through the fund.',
    scope: 'finance:write',
    input: z.object({ id: idSchema, data: transactionInputSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.transactions.update(ctx, id, data),
  }),
  defineTool({
    name: 'finance_delete_transaction',
    title: 'Удалить операцию',
    description:
      'Deletes an operation (a planned payment it paid becomes unpaid). Operations made by a fund are deleted through the fund.',
    scope: 'finance:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.transactions.remove(ctx, id),
  }),
  defineTool({
    name: 'finance_month_summary',
    title: 'Сводка месяца',
    description:
      'Income, expenses and net per currency, account balances, spending by category, daily series and a 6-month trend of a month.',
    scope: 'finance:read',
    input: summaryQuerySchema,
    run: ({ ctx, services }, { month }) => services.summary.getMonthSummary(ctx.workspaceId, month),
  }),
  defineTool({
    name: 'finance_list_budgets',
    title: 'Лимиты месяца',
    description:
      'Spending limits of a month by category and currency, with spent, remaining and progress.',
    scope: 'finance:read',
    input: budgetQuerySchema,
    run: ({ ctx, services }, { month }) => services.budgets.list(ctx.workspaceId, month),
  }),
  defineTool({
    name: 'finance_set_budget',
    title: 'Задать лимит',
    description: 'Creates or changes the limit for (month, expense category, currency).',
    scope: 'finance:write',
    input: z.object({ data: budgetUpsertSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { data }) => services.budgets.upsert(ctx.workspaceId, data),
  }),
  defineTool({
    name: 'finance_copy_budgets',
    title: 'Скопировать лимиты',
    description: 'Copies every limit of one month to another (all or none).',
    scope: 'finance:write',
    input: z.object({ data: budgetCopySchema }),
    run: ({ ctx, services }, { data }) => services.budgets.copy(ctx.workspaceId, data),
  }),
  defineTool({
    name: 'finance_delete_budget',
    title: 'Удалить лимит',
    description: 'Deletes a monthly limit.',
    scope: 'finance:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.budgets.remove(ctx.workspaceId, id),
  }),
];
