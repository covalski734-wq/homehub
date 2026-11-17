import {
  PLANNER_CURRENCIES,
  RECURRING_CATEGORIES,
  type RecurringCategory,
  type RecurringLineDto,
} from '@homehub/shared';
import { CalendarClock, EyeOff, Hourglass, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  EditableTable,
  type Column,
  type MobileSummary,
} from '@/components/editable-table/editable-table';
import { enumOptions, optionValue } from '@/components/editable-table/options';
import { useRowSaves } from '@/components/editable-table/use-row-saves';
import {
  normalizeAmount,
  validateDay,
  validateMoney,
  validateMonth,
  validateOptionalMonth,
  validateRequired,
} from '@/components/editable-table/validators';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { formatMoney } from '@/lib/format';
import { fromCents, sumCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ApplyAmountForward } from './apply-amount-forward';
import { creationOptions } from './labels';
import { PaymentToggle } from './payment-toggle';
import { useMembers } from '../household/api';
import { ownerColumn } from '../household/owner';
import { SharesButton } from '../household/shares';
import { useMonthBudget, usePlannerSettings, useRecurring, useRecurringMutations } from './api';
import {
  recurringChanges,
  recurringCopy,
  recurringDraftInput,
  recurringKind,
  type RecurringColumn,
} from './cell-changes';
import { INTERVAL_OPTIONS, RECURRING_CATEGORY_LABELS } from './labels';
import { t } from '@/i18n';

const currencyOptions = enumOptions(PLANNER_CURRENCIES);

/** Display-currency sum of lines (inactive ones count 0), exact in cents. */
const sumBase = (lines: RecurringLineDto[]) => fromCents(sumCents(lines.map((r) => r.base ?? '0')));

export default function RecurringPage() {
  const { month } = useMonth();
  const recurring = useRecurring(month);
  const settings = usePlannerSettings();
  const mutations = useRecurringMutations(month);
  const saveRow = useRowSaves();
  const members = useMembers();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const select = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids)
        if (on) next.add(id);
        else next.delete(id);
      return next;
    });
  const pay = (r: RecurringLineDto, paid: boolean) =>
    mutations.setPaid.mutateAsync({ id: r.id, paid });
  const [category, setCategory] = useState<RecurringCategory | ''>('');
  const [onlyDue, setOnlyDue] = useState(false);
  const base = settings.data?.baseCurrency ?? 'PLN';

  const rows = useMemo(
    () =>
      (recurring.data ?? []).filter(
        (row) =>
          row.startMonth <= month &&
          (!row.endMonth || row.endMonth >= month) &&
          (!category || row.category === category) &&
          (!onlyDue || row.active),
      ),
    [recurring.data, category, onlyDue, month],
  );
  const chosen = rows.filter((r) => selected.has(r.id));
  const budget = useMonthBudget(month);

  const columns: Column<RecurringLineDto, 'kind' | 'duration'>[] = [
    {
      key: 'name',
      header: t('common.name'),
      editor: 'text',
      value: (r) => r.name,
      validate: validateRequired,
      sortValue: (r) => r.name,
      mobile: 'title',
      width: 'minmax(9rem, 2fr)',
      placeholder: t('planner.recurring.namePlaceholder'),
    },
    {
      key: 'category',
      header: t('common.category'),
      editor: 'select',
      options: enumOptions(RECURRING_CATEGORIES, (c) => RECURRING_CATEGORY_LABELS[c]),
      value: (r) => r.category,
      sortValue: (r) => RECURRING_CATEGORY_LABELS[r.category],
      width: '8.5rem',
    },
    {
      key: 'amount',
      header: t('common.amount'),
      editor: 'money',
      value: (r) => r.amount,
      suffix: (r) => r.currency,
      afterInput: (r) =>
        r.active ? (
          <ApplyAmountForward
            key={month}
            month={month}
            name={r.name}
            amount={r.amount}
            currency={r.currency}
            apply={() =>
              mutations.setAmount.mutateAsync({
                id: r.id,
                data: { month, amount: r.amount, scope: 'FORWARD' },
              })
            }
          />
        ) : null,
      validate: validateMoney,
      sortValue: (r) => Number(r.base ?? r.amount),
      align: 'right',
      mobile: 'amount',
      width: '10rem',
      placeholder: '0,00',
    },
    {
      key: 'currency',
      mobile: 'more',
      desktop: 'more',
      header: t('common.currency'),
      editor: 'select',
      options: currencyOptions,
      value: (r) => r.currency,
      width: '4.75rem',
    },
    {
      key: 'intervalMonths',
      mobile: 'more',
      desktop: 'more',
      header: t('planner.recurring.columns.interval'),
      editor: 'select',
      options: INTERVAL_OPTIONS,
      value: (r) => String(r.intervalMonths),
      width: '8rem',
    },
    {
      key: 'dueDay',
      mobile: 'more',
      header: t('planner.recurring.columns.dueDay'),
      editor: 'day',
      value: (r) => (r.dueDay === null ? '' : String(r.dueDay)),
      validate: validateDay,
      sortValue: (r) => r.dueDay ?? 99,
      align: 'right',
      width: '4.5rem',
      placeholder: '—',
      optional: true,
    },
    {
      key: 'startMonth',
      mobile: 'more',
      desktop: 'more',
      header: t('planner.recurring.columns.from'),
      editor: 'month',
      value: (r) => r.startMonth,
      validate: validateMonth,
      width: '6.25rem',
    },
    {
      key: 'endMonth',
      mobile: 'more',
      desktop: 'more',
      header: t('planner.recurring.columns.to'),
      editor: 'month',
      value: (r) => r.endMonth ?? '',
      validate: validateOptionalMonth,
      width: '6.25rem',
      optional: true,
      placeholder: t('planner.recurring.noEnd'),
    },
    {
      key: 'base',
      header: t('planner.recurring.columns.inBase', { currency: base }),
      render: (r) =>
        !r.active ? (
          <span className="text-xs text-muted-foreground">
            {r.skipped ? t('planner.recurring.skipped') : t('planner.recurring.notThisMonth')}
          </span>
        ) : r.base === null ? (
          <span className="text-xs text-destructive">{t('planner.recurring.noRate')}</span>
        ) : (
          formatMoney(r.base, base)
        ),
      sortValue: (r) => (r.active ? Number(r.base ?? 0) : -1),
      align: 'right',
      width: 'minmax(6.5rem, 1fr)',
    },
  ];

  columns.push(
    ownerColumn<RecurringLineDto>(members.data),
    {
      key: 'shares',
      header: t('planner.recurring.columns.shares'),
      render: (r: RecurringLineDto) => <SharesButton item={{ ...r, name: r.name }} month={month} />,
      mobile: 'more',
      desktop: 'more',
      width: '10rem',
    },
    {
      key: 'isRequired',
      header: t('planner.recurring.columns.group'),
      editor: 'select',
      options: [
        { value: 'true', label: t('planner.recurring.group.required') },
        { value: 'false', label: t('planner.recurring.group.other') },
      ],
      value: (r) => String(r.isRequired),
      mobile: 'more',
      desktop: 'more',
      width: '9rem',
    },
    {
      key: 'kind',
      header: t('common.type'),
      editor: 'select',
      options: [
        { value: 'ONCE', label: t('planner.recurring.kind.once') },
        { value: 'ONGOING', label: t('planner.recurring.kind.ongoing') },
        { value: 'LOAN', label: t('planner.recurring.kind.loan') },
      ],
      value: recurringKind,
      mobile: 'more',
      desktop: 'more',
      width: '11rem',
    },
    {
      key: 'ongoingStartDay',
      header: t('planner.recurring.columns.ongoingStartDay'),
      editor: 'day',
      value: (r) => (r.ongoingStartDay === null ? '' : String(r.ongoingStartDay)),
      validate: validateDay,
      optional: true,
      placeholder: '1',
      editable: (r) => r.isOngoing,
      render: (r) => (r.isOngoing ? String(r.ongoingStartDay ?? 1) : '—'),
      mobile: 'more',
      desktop: 'more',
      width: '6rem',
    },
    {
      key: 'ongoingEndDay',
      header: t('planner.recurring.columns.ongoingEndDay'),
      editor: 'day',
      value: (r) => (r.ongoingEndDay === null ? '' : String(r.ongoingEndDay)),
      validate: validateDay,
      optional: true,
      placeholder: t('planner.recurring.lastDay'),
      editable: (r) => r.isOngoing,
      render: (r) =>
        r.isOngoing
          ? r.ongoingEndDay
            ? String(r.ongoingEndDay)
            : t('planner.recurring.lastDay')
          : '—',
      mobile: 'more',
      desktop: 'more',
      width: '6rem',
    },
    {
      key: 'loanTotal',
      header: t('planner.recurring.columns.loanTotal'),
      editor: 'money',
      value: (r) => r.loanTotal ?? '',
      suffix: (r) => r.currency,
      validate: (value) => (value === '' ? null : validateMoney(value)),
      optional: true,
      placeholder: t('planner.recurring.bySchedule'),
      editable: (r) => r.isLoan,
      render: (r) =>
        r.isLoan
          ? r.loanTotal
            ? formatMoney(r.loanTotal, r.currency)
            : t('planner.recurring.bySchedule')
          : '—',
      mobile: 'more',
      desktop: 'more',
      width: '10rem',
    },
    {
      key: 'paid',
      header: t('planner.recurring.columns.paid'),
      mobile: 'detail',
      width: '8rem',
      render: (r) =>
        r.isOngoing ? (
          <span
            className="inline-flex items-center gap-2 text-xs text-muted-foreground"
            title={t('planner.recurring.ongoingHint')}
          >
            <Hourglass className="size-4" aria-hidden /> {t('planner.recurring.ongoing')}
          </span>
        ) : (
          <PaymentToggle
            key={month}
            name={r.name}
            paid={r.paid}
            active={r.active}
            onChange={(paid) => pay(r, paid)}
          />
        ),
    },
    {
      key: 'duration',
      header: t('planner.recurring.columns.repeat'),
      editor: 'select',
      options: creationOptions,
      editable: () => false,
      render: (r) =>
        r.startMonth === r.endMonth
          ? t('planner.recurring.repeat.once')
          : t('planner.recurring.repeat.scheduled'),
      mobile: 'more',
      desktop: 'more',
      width: '9rem',
    },
  );

  // Keep the monthly payment control visible beside the amount, before schedule details.
  const paidIndex = columns.findIndex((column) => column.key === 'paid');
  columns.splice(3, 0, ...columns.splice(paidIndex, 1));

  const mobileSummary: MobileSummary<RecurringLineDto> = {
    leading: (r) =>
      r.isOngoing ? (
        <span
          className="-m-1 flex p-2.5 text-muted-foreground"
          title={t('planner.recurring.ongoing')}
        >
          <Hourglass className="size-5" aria-hidden />
        </span>
      ) : (
        <PaymentToggle
          key={month}
          compact
          name={r.name}
          paid={r.paid}
          active={r.active}
          onChange={(paid) => pay(r, paid)}
        />
      ),
    subtitle: (r) =>
      [
        RECURRING_CATEGORY_LABELS[r.category],
        r.isOngoing &&
          (r.ongoingStartDay || r.ongoingEndDay
            ? t('planner.recurring.ongoingDays', {
                from: r.ongoingStartDay ?? 1,
                to: r.ongoingEndDay ?? t('planner.recurring.monthEnd'),
              })
            : t('planner.recurring.ongoing')),
        r.isLoan && t('planner.recurring.loan'),
        !r.isOngoing && r.dueDay !== null && t('planner.recurring.dueBy', { day: r.dueDay }),
        r.skipped
          ? t('planner.recurring.skipped')
          : !r.active && t('planner.recurring.notThisMonth'),
        r.active && r.currency !== base && r.base !== null && formatMoney(r.base, base),
      ]
        .filter(Boolean)
        .join(' · '),
    amount: (r) => (
      <span
        className={cn(r.paid && !r.isOngoing && 'text-muted-foreground line-through decoration-1')}
      >
        {formatMoney(r.amount, r.currency)}
      </span>
    ),
  };

  // Saves of one row run in order, each with the version the previous one returned (no false 409).
  const commit = (row: RecurringLineDto, key: RecurringColumn, value: string) =>
    saveRow(
      row.id,
      row.version,
      (version) =>
        key === 'amount'
          ? mutations.setAmount.mutateAsync({
              id: row.id,
              data: { month, amount: normalizeAmount(value), scope: 'MONTH' },
            })
          : mutations.update.mutateAsync({
              id: row.id,
              data: { ...recurringChanges(key, value), version },
            }),
      (line) => line.version,
    );

  const header = (
    <PageHeader
      title={t('planner.recurring.title')}
      description={t('planner.recurring.description')}
      actions={<MonthSwitcher />}
    />
  );

  if (recurring.isPending)
    return (
      <>
        {header}
        <Skeleton className="h-80 w-full rounded-xl" />
      </>
    );
  if (recurring.isError)
    return (
      <>
        {header}
        <ErrorState error={recurring.error} onRetry={() => void recurring.refetch()} />
      </>
    );

  return (
    <>
      {header}
      <p className="mb-3 hidden text-sm text-muted-foreground sm:block">
        {t('planner.recurring.hint')}
      </p>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border bg-card px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">{t('planner.recurring.total')}</p>
          <p className="text-2xl font-semibold tracking-tight tabular">
            {budget.data ? formatMoney(budget.data.totals.recurring, base) : '…'}
          </p>
        </div>
        <p className="text-sm text-muted-foreground" role="status">
          {t('planner.recurring.paidSummary', {
            paid: recurring.data.filter((r) => r.active && !r.isOngoing && r.paid).length,
            count: recurring.data.filter((r) => r.active && !r.isOngoing).length,
          })}
        </p>
      </div>
      {[true, false].map((isRequired) => (
        <section key={String(isRequired)} className="mb-6 space-y-2">
          <h2 className="text-lg font-semibold">
            {isRequired ? t('planner.recurring.requiredTitle') : t('planner.recurring.otherTitle')}
          </h2>
          <EditableTable
            key={month}
            label={
              isRequired ? t('planner.recurring.requiredTitle') : t('planner.recurring.otherTitle')
            }
            rows={rows.filter((r) => r.isRequired === isRequired)}
            columns={columns}
            getRowId={(r) => r.id}
            onCommit={commit}
            selection={{ selected, onChange: select }}
            mobileSummary={mobileSummary}
            actionsWidth="7rem"
            searchText={(r) => `${r.name} ${r.note} ${RECURRING_CATEGORY_LABELS[r.category]}`}
            rowClassName={(r) =>
              !r.active
                ? 'opacity-60'
                : r.paid && !r.isOngoing
                  ? 'bg-emerald-50/60 dark:bg-emerald-950/25'
                  : undefined
            }
            toolbar={
              <>
                <label className="sr-only" htmlFor={`recurring-category-${isRequired}`}>
                  {t('common.category')}
                </label>
                <NativeSelect
                  id={`recurring-category-${isRequired}`}
                  value={category}
                  onChange={(e) =>
                    setCategory(
                      e.target.value === ''
                        ? ''
                        : optionValue(RECURRING_CATEGORIES, e.target.value),
                    )
                  }
                  className="w-36 sm:w-44"
                >
                  <option value="">{t('planner.recurring.allCategories')}</option>
                  {RECURRING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {RECURRING_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  variant={onlyDue ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={onlyDue}
                  onClick={() => setOnlyDue((v) => !v)}
                >
                  <CalendarClock />{' '}
                  <span className="max-sm:sr-only">{t('planner.recurring.scheduled')}</span>
                </Button>
              </>
            }
            rowActions={(r) => {
              const dueInMonth = r.active || r.skipped;
              if (!dueInMonth) return null;
              return (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  aria-label={
                    r.skipped
                      ? t('planner.recurring.unskip', { name: r.name })
                      : t('planner.recurring.skip', { name: r.name })
                  }
                  onClick={() => mutations.setSkipped.mutate({ id: r.id, skipped: !r.skipped })}
                >
                  {r.skipped ? <RotateCcw /> : <EyeOff />}
                </Button>
              );
            }}
            onDelete={async (r) => {
              const { result } = await mutations.stop.mutateAsync(r.id);
              // «Ended» moved the end month (one version up); «deleted» removed the line.
              return result === 'ended'
                ? () =>
                    mutations.update.mutateAsync({
                      id: r.id,
                      data: { endMonth: r.endMonth, version: r.version + 1 },
                    })
                : () => mutations.create.mutateAsync(recurringCopy(r));
            }}
            deleteLabel={(r) => t('planner.recurring.deleted', { name: r.name })}
            draft={{
              addLabel: isRequired
                ? t('planner.recurring.addRequired')
                : t('planner.recurring.addOther'),
              defaults: {
                name: '',
                isRequired: String(isRequired),
                kind: 'ONCE',
                duration: 'FORWARD',
                category: 'OTHER',
                amount: '',
                currency: base,
                intervalMonths: '1',
                dueDay: '',
                startMonth: month,
                endMonth: '',
              },
              required: ['name', 'amount', 'startMonth'],
              create: (v) => mutations.create.mutateAsync(recurringDraftInput(v)),
            }}
            footer={
              <span className="text-muted-foreground">
                {t('planner.recurring.tableTotal')}{' '}
                <strong className="text-foreground tabular">
                  {formatMoney(
                    sumBase(rows.filter((r) => r.isRequired === isRequired && r.active)),
                    base,
                  )}
                </strong>
                {rows.some((r) => r.isRequired === isRequired && r.skipped) && (
                  <Badge className="ml-2">{t('planner.recurring.hasSkipped')}</Badge>
                )}
              </span>
            }
            empty={t('planner.recurring.empty')}
          />
        </section>
      ))}
      {chosen.length > 0 && (
        // Over everything at the bottom: what the ticked rows add up to.
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 px-4 py-3 shadow-lg backdrop-blur md:left-(--sidebar-width)">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <span className="text-sm">
              {t('planner.recurring.selected', { count: chosen.length })} ·{' '}
              <strong className="tabular">{formatMoney(sumBase(chosen), base)}</strong>
            </span>
            <Button variant="outline" size="sm" onClick={() => setSelected(new Set())}>
              {t('planner.recurring.clearSelection')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
