import type { TransactionDto } from '@homehub/shared';
import { t } from '@/i18n';
import { categoryName, operationText } from '@/lib/system-texts';

export function transactionTitle(transaction: TransactionDto): string {
  const text = operationText(transaction);
  if (text) return text;
  if (transaction.type === 'TRANSFER') return t('transactions.title.transfer');
  return transaction.category
    ? categoryName(transaction.category)
    : t('transactions.title.noCategory');
}

export function transactionSubtitle(transaction: TransactionDto): string {
  if (transaction.type === 'TRANSFER')
    return `${transaction.account.name} → ${transaction.toAccount?.name ?? '—'}`;
  const category =
    operationText(transaction) && transaction.category ? categoryName(transaction.category) : null;
  return [category, transaction.account.name].filter(Boolean).join(' · ');
}
