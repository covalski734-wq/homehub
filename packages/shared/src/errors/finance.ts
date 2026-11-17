/** Accounts, operations, budgets. */
export const FINANCE_ERRORS = {
  FINANCE_ACCOUNT_NOT_FOUND: 'Счет не найден',
  FINANCE_ACCOUNT_ARCHIVED: 'Счет в архиве',
  FINANCE_ACCOUNT_NAMED_ARCHIVED: 'Счет «{{name}}» в архиве',
  FINANCE_TRANSACTION_NOT_FOUND: 'Операция не найдена',
  FINANCE_CATEGORY_NOT_FOUND: 'Категория не найдена',
  FINANCE_CATEGORY_KIND: 'Категория не соответствует типу операции',
  FINANCE_BUDGET_EXPENSE_ONLY: 'Лимит задается только для категорий расходов',
  FINANCE_BUDGET_NOT_FOUND: 'Лимит не найден',
  FINANCE_TRANSFER_TO_AMOUNT: 'Укажите сумму зачисления в {{currency}}: валюты счетов отличаются',
  FINANCE_BALANCE_CHANGED: 'Остаток счета изменился, пока вы его сверяли. Проверьте и повторите.',
} as const;
