import type { TransactionDto } from '@homehub/shared';
import { ArrowRight, Receipt } from 'lucide-react';
import { Link } from 'react-router';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDay } from '@/lib/format';
import { AmountText } from '../transactions/amount-text';
import { CategoryDot } from '../transactions/category-dot';
import { transactionSubtitle, transactionTitle } from '../transactions/transaction-title';
import { useTransactions } from '../transactions/use-transactions';
import { t } from '@/i18n';

export function RecentTransactions({
  month,
  onEdit,
}: {
  month: string;
  onEdit: (transaction: TransactionDto) => void;
}) {
  const recent = useTransactions({
    month,
    page: 1,
    pageSize: 6,
    sortBy: 'occurredAt',
    sortDir: 'desc',
  });

  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle>{t('dashboard.recent.title')}</CardTitle>
        <Link
          to={{ pathname: '/finances', search: `?month=${month}` }}
          className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t('common.all')} <ArrowRight className="size-3" aria-hidden />
        </Link>
      </CardHeader>
      {recent.isPending ? (
        <div className="space-y-2 p-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : recent.isError ? (
        <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
      ) : recent.data.items.length === 0 ? (
        <EmptyState icon={<Receipt />} title={t('dashboard.recent.empty')} className="py-8" />
      ) : (
        <ul className="divide-y pb-1">
          {recent.data.items.map((tx) => (
            <li key={tx.id}>
              <button
                type="button"
                onClick={() => onEdit(tx)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted sm:px-5"
              >
                <CategoryDot transaction={tx} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{transactionTitle(tx)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {formatDay(tx.occurredAt)} · {transactionSubtitle(tx)}
                  </span>
                </span>
                <AmountText transaction={tx} className="text-right text-sm" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
