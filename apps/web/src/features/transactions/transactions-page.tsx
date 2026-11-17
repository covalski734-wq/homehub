import { TRANSACTION_TYPES } from '@homehub/shared';
import { ChevronLeft, ChevronRight, Plus, Receipt, X } from 'lucide-react';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMonth } from '@/lib/format';
import { categoryName } from '@/lib/system-texts';
import { useAccounts } from '../accounts/use-accounts';
import { useCategories } from '../categories/use-categories';
import { useTransactionEditor } from './transaction-editor';
import { TYPE_LABELS } from './transaction-labels';
import { TransactionsTable } from './transactions-table';
import { useTransactionFilters } from './use-transaction-filters';
import { useTransactions } from './use-transactions';
import { t } from '@/i18n';

function FilterBar({ state }: { state: ReturnType<typeof useTransactionFilters> }) {
  const accounts = useAccounts();
  const categories = useCategories();
  const { filters, setFilter, clearFilters, hasFilters } = state;
  return (
    <div className="grid grid-cols-2 gap-2 border-b p-3 sm:flex sm:items-center">
      <label className="sr-only" htmlFor="filter-type">
        {t('common.type')}
      </label>
      <NativeSelect
        id="filter-type"
        value={filters.type}
        onChange={(e) => setFilter('type', e.target.value)}
        className="sm:w-40"
      >
        <option value="">{t('transactions.filters.allTypes')}</option>
        {TRANSACTION_TYPES.map((type) => (
          <option key={type} value={type}>
            {TYPE_LABELS[type]}
          </option>
        ))}
      </NativeSelect>
      <label className="sr-only" htmlFor="filter-account">
        {t('transactions.filters.account')}
      </label>
      <NativeSelect
        id="filter-account"
        value={filters.accountId}
        onChange={(e) => setFilter('accountId', e.target.value)}
        className="sm:w-48"
      >
        <option value="">{t('transactions.filters.allAccounts')}</option>
        {accounts.data?.map((account) => (
          <option key={account.id} value={account.id}>
            {account.name}
          </option>
        ))}
      </NativeSelect>
      <label className="sr-only" htmlFor="filter-category">
        {t('common.category')}
      </label>
      <NativeSelect
        id="filter-category"
        value={filters.categoryId}
        onChange={(e) => setFilter('categoryId', e.target.value)}
        className="sm:w-52"
        disabled={filters.type === 'TRANSFER'}
      >
        <option value="">{t('transactions.filters.allCategories')}</option>
        {categories.data
          ?.filter((c) => !filters.type || filters.type === c.kind)
          .map((category) => (
            <option key={category.id} value={category.id}>
              {categoryName(category)}
            </option>
          ))}
      </NativeSelect>
      {hasFilters && (
        <Button variant="ghost" onClick={clearFilters} className="h-10 sm:h-9">
          <X /> {t('transactions.filters.reset')}
        </Button>
      )}
    </div>
  );
}

export default function TransactionsPage() {
  const state = useTransactionFilters();
  const transactions = useTransactions(state.query);
  const editor = useTransactionEditor();
  const data = transactions.data;
  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  let body;
  if (transactions.isPending) {
    body = (
      <div className="space-y-3 p-4" role="status" aria-label={t('transactions.page.loading')}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  } else if (transactions.isError) {
    body = <ErrorState error={transactions.error} onRetry={() => void transactions.refetch()} />;
  } else if (data && data.items.length === 0) {
    body = (
      <EmptyState
        icon={<Receipt />}
        title={
          state.hasFilters
            ? t('common.nothingFound')
            : t('transactions.page.emptyMonth', { month: formatMonth(state.month).toLowerCase() })
        }
        description={
          state.hasFilters ? t('transactions.page.tryFilters') : t('transactions.page.addFirst')
        }
        action={
          state.hasFilters ? (
            <Button variant="outline" onClick={state.clearFilters}>
              {t('transactions.page.resetFilters')}
            </Button>
          ) : (
            <Button onClick={editor.openCreate}>
              <Plus /> {t('transactions.page.add')}
            </Button>
          )
        }
      />
    );
  } else if (data) {
    body = (
      <TransactionsTable
        rows={data.items}
        sortBy={state.sortBy}
        sortDir={state.sortDir}
        onSortChange={state.setSort}
        onEdit={editor.openEdit}
        onDelete={editor.requestDelete}
        isFetching={transactions.isFetching}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={t('common.operations')}
        actions={
          <>
            <MonthSwitcher />
            <Button onClick={editor.openCreate} className="ml-auto sm:ml-0">
              <Plus /> {t('common.add')}
            </Button>
          </>
        }
      />
      <Card className="overflow-hidden">
        <FilterBar state={state} />
        {body}
        {data && data.total > data.pageSize && (
          <nav
            aria-label={t('transactions.pagination.label')}
            className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm"
          >
            <span className="text-muted-foreground tabular">
              {t('transactions.pagination.range', {
                from: (data.page - 1) * data.pageSize + 1,
                to: Math.min(data.page * data.pageSize, data.total),
                total: data.total,
              })}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon-sm"
                disabled={state.page <= 1}
                onClick={() => state.setPage(state.page - 1)}
                aria-label={t('transactions.pagination.previous')}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="outline"
                size="icon-sm"
                disabled={state.page >= pageCount}
                onClick={() => state.setPage(state.page + 1)}
                aria-label={t('transactions.pagination.next')}
              >
                <ChevronRight />
              </Button>
            </div>
          </nav>
        )}
      </Card>
      {editor.dialogs}
    </>
  );
}
