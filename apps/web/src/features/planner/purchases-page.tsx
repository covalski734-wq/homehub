import {
  PLANNER_CURRENCIES,
  PURCHASE_CATEGORIES,
  PURCHASE_PRIORITIES,
  todayDate,
  type PurchaseCategory,
  type PurchaseDto,
  type PurchaseEventDto,
  type PurchasePriority,
  type PurchaseStatus,
} from '@homehub/shared';
import { Ban, CalendarCheck, History, Loader2, RotateCcw, ShoppingBag, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  EditableTable,
  type Column,
  type MobileSummary,
} from '@/components/editable-table/editable-table';
import { enumOptions, optionValue } from '@/components/editable-table/options';
import { useRowSaves } from '@/components/editable-table/use-row-saves';
import {
  validateDate,
  validateMoney,
  validateOptionalMonth,
  validateRequired,
} from '@/components/editable-table/validators';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { errorMessage } from '@/lib/api';
import { formatDay, formatFullDate, formatMoney, formatMonth, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useMonthBudget,
  usePurchaseHistory,
  usePurchaseMutations,
  usePurchases,
  type PurchaseFilterStatus,
  type PurchaseStatusAction,
} from './api';
import {
  completesPurchase,
  purchaseChanges,
  purchaseCompletion,
  purchaseCopy,
  purchaseDraftInput,
  type PurchaseColumn,
} from './cell-changes';
import { EVENT_LABELS, PRIORITY_LABELS, PURCHASE_CATEGORY_LABELS, STATUS_LABELS } from './labels';
import { useMembers } from '../household/api';
import { ownerColumn } from '../household/owner';
import { SharesButton } from '../household/shares';
import { t } from '@/i18n';

const currencyOptions = enumOptions(PLANNER_CURRENCIES);
const PRIORITY_ORDER: Record<PurchasePriority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function StatusBadge({ status }: { status: PurchaseStatus }) {
  return (
    <Badge
      className={cn(
        status === 'PURCHASED' && 'border-income/30 bg-income/10 text-income',
        status === 'CANCELLED' && 'line-through',
      )}
    >
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/** When a purchase was made, and for how much when the price is known. */
function purchasedWhen(event: PurchaseEventDto): string {
  const when = event.date
    ? formatFullDate(event.date)
    : t('planner.purchases.history.noExactDate', {
        month: formatMonth(event.toMonth!).toLowerCase(),
      });
  return event.amount && event.currency
    ? t('planner.purchases.history.whenFor', {
        when,
        amount: formatMoney(event.amount, event.currency),
      })
    : when;
}

function PurchaseHistory({ purchase }: { purchase: PurchaseDto }) {
  const history = usePurchaseHistory(purchase.id, true);
  return (
    <div className="border-b bg-muted/20 px-4 py-3 md:pl-10">
      <h3 className="mb-2 text-xs font-medium text-muted-foreground">
        {t('planner.purchases.history.title', { title: purchase.title })}
      </h3>
      {history.isPending ? (
        <Loader2
          className="size-4 animate-spin text-muted-foreground"
          aria-label={t('planner.purchases.history.loading')}
        />
      ) : history.isError ? (
        <p className="text-sm text-destructive">{errorMessage(history.error)}</p>
      ) : (
        <ol className="space-y-1.5 border-l pl-4">
          {history.data.map((event) => (
            <li key={event.id} className="relative text-sm">
              <span
                className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-muted-foreground/60"
                aria-hidden
              />
              <span className="font-medium">{EVENT_LABELS[event.type]}</span>
              {event.type === 'RESCHEDULED' && (
                <span className="text-muted-foreground">
                  {' '}
                  {event.fromMonth
                    ? formatMonth(event.fromMonth)
                    : t('planner.purchases.history.noMonth')}{' '}
                  →{' '}
                  {event.toMonth
                    ? formatMonth(event.toMonth)
                    : t('planner.purchases.history.noMonth')}
                </span>
              )}
              {event.type === 'CREATED' && event.toMonth && (
                <span className="text-muted-foreground">
                  {' '}
                  {t('planner.purchases.history.createdFor', {
                    month: formatMonth(event.toMonth).toLowerCase(),
                  })}
                </span>
              )}
              {event.type === 'PURCHASED' && (event.date || event.toMonth) && (
                <span className="text-muted-foreground"> {purchasedWhen(event)}</span>
              )}
              <span className="block text-xs text-muted-foreground">
                {formatTimestamp(event.createdAt)}
                {event.createdBy ? ` · ${event.createdBy.name ?? event.createdBy.email}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function PurchasesPage() {
  const { month } = useMonth();
  const purchases = usePurchases();
  const budget = useMonthBudget(month);
  const mutations = usePurchaseMutations();
  const saveRow = useRowSaves();
  const [status, setStatus] = useState<PurchaseFilterStatus>('ACTIVE');
  const [category, setCategory] = useState<PurchaseCategory | ''>('');
  const [onlyMonth, setOnlyMonth] = useState(false);
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const members = useMembers();
  const buy = (p: PurchaseDto) =>
    mutations.complete.mutate({
      id: p.id,
      data: { purchasedOn: todayDate(), actualAmount: p.estimatedAmount, version: p.version },
    });

  const rows = useMemo(
    () =>
      (purchases.data ?? []).filter(
        (p) =>
          (status === 'ALL' || p.status === status) &&
          (!category || p.category === category) &&
          (!onlyMonth || p.budgetMonth === month),
      ),
    [purchases.data, status, category, onlyMonth, month],
  );

  const statusChange = mutations.setStatus;
  const busy = (p: PurchaseDto) =>
    (statusChange.isPending && statusChange.variables.id === p.id) ||
    (mutations.complete.isPending && mutations.complete.variables.id === p.id);
  const changeStatus = (p: PurchaseDto, action: PurchaseStatusAction, message: string) =>
    statusChange.mutate(
      { id: p.id, action, version: p.version },
      {
        onSuccess: () => toast.success(message),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  const allColumns: Column<PurchaseDto>[] = [
    {
      key: 'title',
      header: t('planner.purchases.columns.title'),
      editor: 'text',
      value: (p) => p.title,
      validate: validateRequired,
      sortValue: (p) => p.title,
      mobile: 'title',
      width: 'minmax(10rem, 2fr)',
      placeholder: t('planner.purchases.titlePlaceholder'),
    },
    {
      key: 'category',
      header: t('common.category'),
      editor: 'select',
      options: enumOptions(PURCHASE_CATEGORIES, (c) => PURCHASE_CATEGORY_LABELS[c]),
      value: (p) => p.category,
      sortValue: (p) => PURCHASE_CATEGORY_LABELS[p.category],
      width: 'minmax(7rem, 1fr)',
    },
    {
      key: 'priority',
      mobile: 'more',
      header: t('planner.purchases.columns.priority'),
      editor: 'select',
      options: enumOptions(PURCHASE_PRIORITIES, (p) => PRIORITY_LABELS[p]),
      value: (p) => p.priority,
      sortValue: (p) => PRIORITY_ORDER[p.priority],
      width: '7.5rem',
    },
    {
      key: 'estimatedAmount',
      header: t('planner.purchases.columns.price'),
      editor: 'money',
      value: (p) => p.estimatedAmount,
      suffix: (p) => p.currency,
      validate: validateMoney,
      sortValue: (p) => Number(p.estimatedAmount),
      align: 'right',
      mobile: 'amount',
      width: 'minmax(8rem, 1fr)',
      placeholder: '0,00',
    },
    {
      key: 'currency',
      mobile: 'more',
      desktop: 'more',
      header: t('common.currency'),
      editor: 'select',
      options: currencyOptions,
      value: (p) => p.currency,
      width: '4.75rem',
    },
    {
      key: 'plannedMonth',
      header: t('planner.purchases.columns.plannedMonth'),
      editor: 'month',
      value: (p) => p.plannedMonth ?? '',
      validate: validateOptionalMonth,
      optional: true,
      sortValue: (p) => p.plannedMonth ?? '9999',
      editable: (p) => p.status !== 'CANCELLED',
      render: (p) => (p.plannedMonth ? formatMonth(p.plannedMonth) : '—'),
      width: '7rem',
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (p) => <StatusBadge status={p.status} />,
      sortValue: (p) => p.status,
      width: '7rem',
    },
    {
      key: 'purchasedOn',
      header: t('planner.purchases.columns.purchasedOn'),
      editor: 'date',
      value: (p) => p.purchasedOn ?? '',
      // Empty: bought in the planned month, exact date unknown (e.g. imported from Excel).
      validate: (value) => (value === '' ? null : validateDate(value)),
      optional: true,
      placeholder: t('planner.purchases.noDate'),
      editable: (p) => p.status === 'PURCHASED',
      render: () => <span className="text-muted-foreground">—</span>,
      width: '9.5rem',
    },
    {
      key: 'actualAmount',
      header: t('planner.purchases.columns.actual'),
      editor: 'money',
      value: (p) => p.actualAmount ?? '',
      suffix: (p) => p.currency,
      validate: validateMoney,
      editable: (p) => p.status === 'PURCHASED',
      render: () => <span className="text-muted-foreground">—</span>,
      align: 'right',
      width: 'minmax(7rem, 1fr)',
    },
  ];
  // Columns that are always empty (or redundant) for the chosen status are hidden: the table fits without scrolling.
  const hidden = new Set<PurchaseColumn>(
    status === 'ACTIVE' || status === 'CANCELLED'
      ? ['purchasedOn', 'actualAmount', 'status']
      : status === 'PURCHASED'
        ? ['status']
        : [],
  );
  allColumns.push(ownerColumn<PurchaseDto>(members.data), {
    key: 'shares',
    header: t('planner.purchases.columns.shares'),
    render: (r: PurchaseDto) => <SharesButton item={{ ...r, name: r.title }} month={month} />,
    mobile: 'more',
    desktop: 'more',
    width: '10rem',
  });
  const columns = allColumns.filter((c) => !hidden.has(c.key));

  const mobileSummary: MobileSummary<PurchaseDto> = {
    subtitle: (p) =>
      [
        PURCHASE_CATEGORY_LABELS[p.category],
        p.status === 'PURCHASED'
          ? p.purchasedOn
            ? t('planner.purchases.summary.purchasedOn', { date: formatDay(p.purchasedOn) })
            : t('planner.purchases.summary.purchased')
          : p.status === 'CANCELLED'
            ? STATUS_LABELS.CANCELLED.toLowerCase()
            : p.plannedMonth
              ? formatMonth(p.plannedMonth).toLowerCase()
              : t('planner.purchases.noMonth'),
        p.status === 'ACTIVE' &&
          p.priority === 'HIGH' &&
          t('planner.purchases.summary.highPriority'),
      ]
        .filter(Boolean)
        .join(' · '),
    amount: (p) => formatMoney(p.budgetAmount, p.currency),
  };

  // Saves of one row run in order, each with the version the previous one returned.
  const commit = (p: PurchaseDto, key: PurchaseColumn, value: string) =>
    saveRow(
      p.id,
      p.version,
      (version) =>
        completesPurchase(key)
          ? mutations.complete.mutateAsync({
              id: p.id,
              data: { ...purchaseCompletion(p, key, value), version },
            })
          : mutations.update.mutateAsync({
              id: p.id,
              data: { ...purchaseChanges(key, value), version },
            }),
      (saved) => saved.version,
    );

  const monthTotal = budget.data
    ? formatMoney(budget.data.totals.purchases, budget.data.baseCurrency)
    : '…';

  const header = (
    <PageHeader
      title={t('planner.purchases.title')}
      description={t('planner.purchases.description')}
      actions={<MonthSwitcher />}
    />
  );

  if (purchases.isPending)
    return (
      <>
        {header}
        <Skeleton className="h-80 w-full rounded-xl" />
      </>
    );
  if (purchases.isError)
    return (
      <>
        {header}
        <ErrorState error={purchases.error} onRetry={() => void purchases.refetch()} />
      </>
    );

  return (
    <>
      {header}
      <EditableTable
        label={t('planner.purchases.title')}
        rows={rows}
        columns={columns}
        getRowId={(p) => p.id}
        onCommit={commit}
        mobileSummary={mobileSummary}
        searchText={(p) => `${p.title} ${p.note}`}
        rowClassName={(p) =>
          cn(
            p.status === 'CANCELLED' && 'opacity-60',
            p.budgetMonth === month && p.status !== 'CANCELLED' && 'bg-primary/[0.03]',
          )
        }
        expanded={(p) => (historyOpen === p.id ? <PurchaseHistory purchase={p} /> : null)}
        toolbar={
          <>
            <SegmentedControl
              label={t('common.status')}
              value={status}
              onChange={setStatus}
              options={[
                { value: 'ACTIVE', label: t('planner.purchaseStatus.active') },
                { value: 'PURCHASED', label: t('planner.purchaseStatus.purchased') },
                { value: 'CANCELLED', label: t('planner.purchaseStatus.cancelled') },
                { value: 'ALL', label: t('common.all') },
              ]}
              className="w-full sm:w-auto"
            />
            <label className="sr-only" htmlFor="purchase-category">
              {t('common.category')}
            </label>
            <NativeSelect
              id="purchase-category"
              value={category}
              onChange={(e) =>
                setCategory(
                  e.target.value === '' ? '' : optionValue(PURCHASE_CATEGORIES, e.target.value),
                )
              }
              className="w-40"
            >
              <option value="">{t('planner.purchases.filter.allCategories')}</option>
              {PURCHASE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {PURCHASE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant={onlyMonth ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={onlyMonth}
              onClick={() => setOnlyMonth((v) => !v)}
            >
              <CalendarCheck /> {formatMonth(month)}
            </Button>
          </>
        }
        actionsWidth="14.5rem"
        rowActions={(p) => (
          <>
            {p.status === 'ACTIVE' && (
              <Button variant="outline" size="sm" disabled={busy(p)} onClick={() => buy(p)}>
                <ShoppingBag /> {t('planner.purchases.actions.buy')}
              </Button>
            )}
            {p.status === 'ACTIVE' && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('planner.purchases.actions.cancelLabel', { title: p.title })}
                disabled={busy(p)}
                onClick={() => changeStatus(p, 'cancel', t('planner.purchases.toast.cancelled'))}
              >
                <Ban className="text-muted-foreground" />
              </Button>
            )}
            {p.status === 'PURCHASED' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy(p)}
                onClick={() =>
                  changeStatus(p, 'unpurchase', t('planner.purchases.toast.unpurchased'))
                }
              >
                <Undo2 />{' '}
                <span className="hidden lg:inline">
                  {t('planner.purchases.actions.unpurchase')}
                </span>
              </Button>
            )}
            {p.status === 'CANCELLED' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy(p)}
                onClick={() => changeStatus(p, 'restore', t('planner.purchases.toast.restored'))}
              >
                <RotateCcw /> {t('planner.purchases.actions.restore')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('planner.purchases.actions.historyLabel', { title: p.title })}
              aria-expanded={historyOpen === p.id}
              onClick={() => setHistoryOpen((id) => (id === p.id ? null : p.id))}
            >
              <History className="text-muted-foreground" />
            </Button>
          </>
        )}
        onDelete={async (p) => {
          await mutations.remove.mutateAsync(p.id);
          return () => mutations.create.mutateAsync(purchaseCopy(p));
        }}
        deleteLabel={(p) => t('planner.purchases.deleted', { title: p.title })}
        draft={{
          addLabel: t('planner.purchases.add'),
          defaults: {
            title: '',
            category: 'OTHER',
            priority: 'MEDIUM',
            estimatedAmount: '',
            currency: budget.data?.baseCurrency ?? 'PLN',
            plannedMonth: onlyMonth ? month : '',
          },
          required: ['title', 'estimatedAmount'],
          create: (v) => mutations.create.mutateAsync(purchaseDraftInput(v)),
        }}
        footer={
          <span className="text-muted-foreground">
            {t('planner.purchases.footer.inBudget', { month: formatMonth(month).toLowerCase() })}{' '}
            <strong className="text-foreground tabular">{monthTotal}</strong>
          </span>
        }
        empty={status === 'ACTIVE' ? t('planner.purchases.empty') : t('common.nothingFound')}
      />
    </>
  );
}
