import type { TransactionDto } from '@homehub/shared';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export function AmountText({
  transaction,
  className,
}: {
  transaction: TransactionDto;
  className?: string;
}) {
  const { type, amount, currency, toAmount, toCurrency } = transaction;
  if (type === 'TRANSFER') {
    const crossCurrency = toCurrency && toCurrency !== currency && toAmount;
    return (
      <span className={cn('tabular text-foreground', className)}>
        {formatMoney(amount, currency)}
        {crossCurrency && (
          <span className="block text-xs text-muted-foreground">
            → {formatMoney(toAmount, toCurrency)}
          </span>
        )}
      </span>
    );
  }
  const isIncome = type === 'INCOME';
  return (
    <span
      className={cn('tabular font-medium', isIncome ? 'text-income' : 'text-foreground', className)}
    >
      {isIncome ? '+' : '−'}
      {formatMoney(amount, currency)}
    </span>
  );
}
