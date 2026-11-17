import type { AccountType, TransactionType } from '@homehub/shared';
import { t } from '@/i18n';

export const TYPE_LABELS: Record<TransactionType, string> = {
  EXPENSE: t('common.expense'),
  INCOME: t('common.income'),
  TRANSFER: t('transactions.types.transfer'),
};

export const TYPE_OPTIONS = (['EXPENSE', 'INCOME', 'TRANSFER'] as const).map((value) => ({
  value,
  label: TYPE_LABELS[value],
}));

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CARD: t('transactions.accountTypes.card'),
  CASH: t('transactions.accountTypes.cash'),
  BANK: t('transactions.accountTypes.bank'),
  SAVINGS: t('common.savings'),
  OTHER: t('common.other'),
};
