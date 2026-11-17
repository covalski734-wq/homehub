import type { TransactionDto } from '@homehub/shared';
import { ArrowLeftRight } from 'lucide-react';
import { categoryName } from '@/lib/system-texts';

export function CategoryDot({ transaction }: { transaction: TransactionDto }) {
  if (transaction.type === 'TRANSFER') {
    return (
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-transfer/10 text-transfer"
        aria-hidden
      >
        <ArrowLeftRight className="size-3.5" />
      </span>
    );
  }
  const color = transaction.category?.color ?? '#6b7280';
  return (
    <span
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
      style={{ backgroundColor: `${color}1f`, color }}
      aria-hidden
    >
      {(transaction.category ? categoryName(transaction.category) : '?').slice(0, 1)}
    </span>
  );
}
