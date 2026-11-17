import type { FinanceSummaryDto } from '@homehub/shared';
import { Plus, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { useAccounts } from '../accounts/use-accounts';
import { useTransactionEditor } from '../transactions/transaction-editor';
import { CategoryBreakdown } from './category-breakdown';
import { KpiStrip } from './kpi-strip';
import { RecentTransactions } from './recent-transactions';
import { TrendChart } from './trend-chart';
import { useSummary } from './use-summary';
import { t } from '@/i18n';

/** Currencies are never summed together, so the dashboard shows one currency at a time. */
function currenciesOf(summary: FinanceSummaryDto): string[] {
  const active = summary.totals.map((t) => t.currency);
  const rest = summary.balances.map((b) => b.currency).filter((c) => !active.includes(c));
  return [...active, ...rest];
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label={t('dashboard.loading')}>
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-xl lg:col-span-3" />
        <Skeleton className="h-72 rounded-xl lg:col-span-2" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { month } = useMonth();
  const summary = useSummary(month);
  const accounts = useAccounts();
  const editor = useTransactionEditor();
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);

  const header = (
    <PageHeader
      title={t('dashboard.title')}
      description={t('dashboard.description')}
      actions={
        <>
          <MonthSwitcher />
          <Button onClick={editor.openCreate} className="ml-auto sm:ml-0">
            <Plus /> {t('common.operation')}
          </Button>
        </>
      }
    />
  );

  if (summary.isPending || accounts.isPending)
    return (
      <>
        {header}
        <DashboardSkeleton />
      </>
    );
  if (summary.isError)
    return (
      <>
        {header}
        <Card>
          <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
        </Card>
      </>
    );

  if (accounts.data?.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<Wallet />}
            title={t('dashboard.welcome.title')}
            description={t('dashboard.welcome.description')}
            action={
              <Button asChild>
                <Link to="/accounts">{t('dashboard.welcome.addAccount')}</Link>
              </Button>
            }
          />
        </Card>
      </>
    );
  }

  const data = summary.data;
  const currencies = currenciesOf(data);
  const currency =
    selectedCurrency && currencies.includes(selectedCurrency)
      ? selectedCurrency
      : (currencies[0] ?? 'RUB');

  return (
    <>
      {header}
      <div className="space-y-4">
        {currencies.length > 1 && (
          <SegmentedControl
            label={t('common.currency')}
            value={currency}
            onChange={setSelectedCurrency}
            options={currencies.map((c) => ({ value: c, label: c }))}
            className="w-fit"
          />
        )}
        <KpiStrip
          currency={currency}
          totals={data.totals.find((t) => t.currency === currency)}
          balance={data.balances.find((b) => b.currency === currency)}
        />
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <TrendChart currency={currency} trend={data.trend} daily={data.daily} />
          </div>
          <div className="lg:col-span-2">
            <CategoryBreakdown currency={currency} items={data.byCategory} />
          </div>
        </div>
        <RecentTransactions month={month} onEdit={editor.openEdit} />
      </div>
      {editor.dialogs}
    </>
  );
}
