import {
  INCOME_KINDS,
  PLANNER_CURRENCIES,
  type DeductionDto,
  type IncomeLineDto,
} from '@homehub/shared';
import { ChevronDown, ChevronRight, EyeOff, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { EditableTable, type Column } from '@/components/editable-table/editable-table';
import { enumOptions } from '@/components/editable-table/options';
import { useRowSaves } from '@/components/editable-table/use-row-saves';
import {
  normalizeAmount,
  validateMoney,
  validateMonth,
  validateOptionalMonth,
  validatePercent,
  validateRequired,
} from '@/components/editable-table/validators';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { formatMoney } from '@/lib/format';
import { ApplyAmountForward } from './apply-amount-forward';
import { creationOptions } from './labels';
import { useIncomeMutations, useIncomes, useMonthBudget } from './api';
import {
  deductionChanges,
  deductionCopy,
  deductionDraftInput,
  deductionType,
  incomeChanges,
  incomeDraftInput,
  type DeductionColumn,
  type IncomeColumn,
} from './cell-changes';
import { INCOME_KIND_LABELS } from './labels';
import { useMembers } from '../household/api';
import { ownerColumn } from '../household/owner';
import { SharesButton } from '../household/shares';
import { t } from '@/i18n';

const currencyOptions = enumOptions(PLANNER_CURRENCIES);
const kindOptions = enumOptions(INCOME_KINDS, (k) => INCOME_KIND_LABELS[k]);

function deductionSummary(line: IncomeLineDto): string {
  if (line.deductions.length === 0) return t('planner.incomes.deductions.none');
  return line.deductions
    .map((d) =>
      d.kind === 'PERCENT' ? `${Number(d.rate)}%` : formatMoney(d.amount ?? '0', d.currency),
    )
    .join(' + ');
}

/** Taxes, contributions and commissions of one income, edited inline. Nothing is hard-coded. */
function Deductions({ line, month }: { line: IncomeLineDto; month: string }) {
  const mutations = useIncomeMutations(month);
  const saveRow = useRowSaves();
  const columns: Column<DeductionDto, 'value'>[] = [
    {
      key: 'name',
      header: t('planner.incomes.deductions.columns.name'),
      editor: 'text',
      value: (d) => d.name,
      validate: validateRequired,
      mobile: 'title',
      width: 'minmax(9rem, 2fr)',
      placeholder: t('planner.incomes.deductions.namePlaceholder'),
    },
    {
      key: 'kind',
      mobile: 'more',
      header: t('common.type'),
      editor: 'select',
      options: [
        { value: 'PERCENT', label: t('planner.incomes.deductions.type.percent') },
        { value: 'REMAINDER', label: t('planner.incomes.deductions.type.remainder') },
        { value: 'FIXED', label: t('planner.incomes.deductions.type.fixed') },
      ],
      value: deductionType,
      width: 'minmax(10rem, 1fr)',
    },
    {
      key: 'value',
      header: t('planner.incomes.deductions.columns.value'),
      editor: 'money',
      value: (d) => (d.kind === 'PERCENT' ? (d.rate ?? '') : (d.amount ?? '')),
      suffix: (d) => (d.kind === 'PERCENT' ? '%' : d.currency),
      validate: (value, d) => (d?.kind === 'FIXED' ? validateMoney(value) : validatePercent(value)),
      align: 'right',
      mobile: 'amount',
      width: 'minmax(7rem, 1fr)',
    },
    {
      key: 'currency',
      mobile: 'more',
      header: t('common.currency'),
      editor: 'select',
      options: currencyOptions,
      value: (d) => d.currency,
      editable: (d) => d.kind === 'FIXED',
      render: () => <span className="text-muted-foreground">—</span>,
      width: '4.75rem',
    },
    {
      key: 'startMonth',
      mobile: 'more',
      header: t('planner.incomes.deductions.columns.from'),
      editor: 'month',
      value: (d) => d.startMonth ?? '',
      validate: validateOptionalMonth,
      optional: true,
      width: '6.25rem',
    },
    {
      key: 'endMonth',
      mobile: 'more',
      header: t('planner.incomes.deductions.columns.to'),
      editor: 'month',
      value: (d) => d.endMonth ?? '',
      validate: validateOptionalMonth,
      optional: true,
      width: '6.25rem',
    },
    {
      key: 'monthAmount',
      header: t('planner.incomes.deductions.columns.thisMonth'),
      render: (d) =>
        d.active && d.monthAmount !== null ? formatMoney(d.monthAmount, line.currency) : '—',
      align: 'right',
      width: 'minmax(7rem, 1fr)',
    },
  ];

  return (
    <div className="border-b bg-muted/20 px-3 py-3 md:pl-10">
      <EditableTable
        label={t('planner.incomes.deductions.tableLabel', { name: line.name })}
        rows={line.deductions}
        columns={columns}
        getRowId={(d) => d.id}
        onCommit={(d, key: DeductionColumn, value) =>
          saveRow(
            d.id,
            d.version,
            (version) =>
              mutations.updateDeduction.mutateAsync({
                id: d.id,
                data: { ...deductionChanges(d, key, value, line.currency), version },
              }),
            // The server answers with the whole income line.
            (saved) => saved.deductions.find((x) => x.id === d.id)?.version ?? 0,
          )
        }
        onDelete={async (d) => {
          await mutations.deleteDeduction.mutateAsync(d.id);
          return () =>
            mutations.addDeduction.mutateAsync({
              incomeId: line.id,
              data: deductionCopy(d, line.currency),
            });
        }}
        deleteLabel={(d) => t('planner.incomes.deductions.deleted', { name: d.name })}
        draft={{
          addLabel: t('planner.incomes.deductions.add'),
          defaults: {
            name: '',
            kind: 'PERCENT',
            value: '',
            currency: line.currency,
            startMonth: '',
            endMonth: '',
          },
          required: ['name', 'value'],
          create: (v) =>
            mutations.addDeduction.mutateAsync({
              incomeId: line.id,
              data: deductionDraftInput(v, line.currency),
            }),
        }}
        empty={t('planner.incomes.deductions.empty')}
      />
    </div>
  );
}

export default function IncomesPage() {
  const { month } = useMonth();
  const incomes = useIncomes(month);
  const budget = useMonthBudget(month);
  const mutations = useIncomeMutations(month);
  const saveRow = useRowSaves();
  const members = useMembers();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const base = budget.data?.baseCurrency ?? 'PLN';

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: Column<IncomeLineDto, 'duration'>[] = [
    {
      key: 'name',
      header: t('planner.incomes.columns.source'),
      editor: 'text',
      value: (r) => r.name,
      validate: validateRequired,
      sortValue: (r) => r.name,
      mobile: 'title',
      width: 'minmax(10rem, 2fr)',
      placeholder: t('planner.incomes.sourcePlaceholder'),
    },
    {
      key: 'kind',
      mobile: 'more',
      header: t('common.type'),
      editor: 'select',
      options: kindOptions,
      value: (r) => r.kind,
      width: 'minmax(8rem, 1fr)',
    },
    {
      key: 'gross',
      header: t('common.amount'),
      editor: 'money',
      value: (r) => r.gross,
      suffix: (r) => r.currency,
      afterInput: (r) =>
        r.active ? (
          <ApplyAmountForward
            key={month}
            month={month}
            name={r.name}
            amount={r.gross}
            currency={r.currency}
            apply={() =>
              mutations.setAmount.mutateAsync({
                id: r.id,
                data: { month, amount: r.gross, scope: 'FORWARD' },
              })
            }
          />
        ) : null,
      validate: validateMoney,
      sortValue: (r) => Number(r.grossBase ?? r.gross),
      align: 'right',
      mobile: 'amount',
      width: 'minmax(8rem, 1fr)',
      placeholder: '0,00',
    },
    {
      key: 'currency',
      mobile: 'more',
      header: t('common.currency'),
      editor: 'select',
      options: currencyOptions,
      value: (r) => r.currency,
      width: '4.75rem',
    },
    {
      key: 'deductions',
      header: t('planner.incomes.columns.deductions'),
      render: (r) => (
        <button
          type="button"
          onClick={() => toggle(r.id)}
          aria-expanded={open.has(r.id)}
          className="inline-flex max-w-full items-center gap-1 truncate rounded-sm text-left text-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {open.has(r.id) ? (
            <ChevronDown className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">{deductionSummary(r)}</span>
        </button>
      ),
      width: 'minmax(9rem, 1.2fr)',
    },
    {
      key: 'net',
      header: t('planner.incomes.columns.net'),
      render: (r) =>
        r.active ? (
          formatMoney(r.net, r.currency)
        ) : (
          <span className="text-xs text-muted-foreground">
            {r.overridden ? '' : t('planner.incomes.notThisMonth')}
          </span>
        ),
      sortValue: (r) => Number(r.netBase ?? r.net),
      align: 'right',
      width: 'minmax(7rem, 1fr)',
    },
    {
      key: 'netBase',
      mobile: 'more',
      header: t('planner.incomes.columns.inBase', { currency: base }),
      render: (r) =>
        !r.active ? (
          '—'
        ) : r.netBase === null ? (
          <span className="text-xs text-destructive">{t('planner.incomes.noRate')}</span>
        ) : (
          formatMoney(r.netBase, base)
        ),
      align: 'right',
      width: 'minmax(7rem, 1fr)',
    },
    {
      key: 'startMonth',
      mobile: 'more',
      header: t('planner.incomes.columns.start'),
      editor: 'month',
      value: (r) => r.startMonth,
      validate: validateMonth,
      width: '6.25rem',
    },
    {
      key: 'endMonth',
      mobile: 'more',
      header: t('planner.incomes.columns.end'),
      editor: 'month',
      value: (r) => r.endMonth ?? '',
      validate: validateOptionalMonth,
      optional: true,
      width: '6.25rem',
      placeholder: t('planner.incomes.noEnd'),
    },
  ];
  columns.push(ownerColumn<IncomeLineDto>(members.data), {
    key: 'shares',
    header: t('planner.incomes.columns.shares'),
    render: (r: IncomeLineDto) => <SharesButton item={{ ...r, name: r.name }} month={month} />,
    mobile: 'more',
    desktop: 'more',
    width: '10rem',
  });

  columns.push({
    key: 'duration',
    header: t('planner.incomes.columns.repeat'),
    editor: 'select',
    options: creationOptions,
    editable: () => false,
    render: (r) =>
      r.endMonth === r.startMonth
        ? t('planner.incomes.repeat.once')
        : t('planner.incomes.repeat.monthly'),
    mobile: 'more',
    width: '9rem',
  });

  const header = (
    <PageHeader
      title={t('common.incomes')}
      description={t('planner.incomes.description')}
      actions={<MonthSwitcher />}
    />
  );

  if (incomes.isPending)
    return (
      <>
        {header}
        <Skeleton className="h-80 w-full rounded-xl" />
      </>
    );
  if (incomes.isError)
    return (
      <>
        {header}
        <ErrorState error={incomes.error} onRetry={() => void incomes.refetch()} />
      </>
    );

  const totals = budget.data?.totals;
  return (
    <>
      {header}
      <p className="mb-3 text-sm text-muted-foreground">{t('planner.incomes.hint')}</p>
      <EditableTable
        key={month}
        label={t('planner.incomes.tableLabel')}
        rows={incomes.data.filter(
          (r) => r.startMonth <= month && (!r.endMonth || r.endMonth >= month),
        )}
        columns={columns}
        getRowId={(r) => r.id}
        searchText={(r) => r.name}
        rowClassName={(r) => (r.active ? undefined : 'opacity-60')}
        expanded={(r) => (open.has(r.id) ? <Deductions line={r} month={month} /> : null)}
        onCommit={(row, key: IncomeColumn, value) =>
          // Saves of one row run in order, each with the version the previous one returned.
          saveRow(
            row.id,
            row.version,
            (version) =>
              key === 'gross'
                ? mutations.setAmount.mutateAsync({
                    id: row.id,
                    data: { month, amount: normalizeAmount(value), scope: 'MONTH' },
                  })
                : mutations.update.mutateAsync({
                    id: row.id,
                    data: { ...incomeChanges(key, value), version },
                  }),
            (line) => line.version,
          )
        }
        actionsWidth="5.5rem"
        rowActions={(r) => (
          <>
            {r.active ||
            (!r.active && r.startMonth <= month && (r.endMonth === null || r.endMonth >= month)) ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                aria-label={
                  r.active
                    ? t('planner.incomes.skip', { name: r.name })
                    : t('planner.incomes.unskip', { name: r.name })
                }
                onClick={() => mutations.setSkipped.mutate({ id: r.id, skipped: r.active })}
              >
                {r.active ? <EyeOff /> : <RotateCcw />}
              </Button>
            ) : null}
          </>
        )}
        onDelete={async (r) => {
          const { result } = await mutations.stop.mutateAsync(r.id);
          // «Ended» moved the end month (one version up); «deleted» removed the line.
          return result === 'ended'
            ? () =>
                mutations.update.mutateAsync({
                  id: r.id,
                  data: { endMonth: r.endMonth, version: r.version + 1 },
                })
            : () =>
                mutations.create.mutateAsync({
                  name: r.name,
                  kind: r.kind,
                  currency: r.currency,
                  amount: r.gross,
                  startMonth: r.startMonth,
                  endMonth: r.endMonth,
                });
        }}
        deleteLabel={(r) => t('planner.incomes.deleted', { name: r.name })}
        draft={{
          addLabel: t('planner.incomes.add'),
          defaults: {
            name: '',
            kind: 'SALARY',
            gross: '',
            currency: base,
            startMonth: month,
            endMonth: '',
            duration: 'FORWARD',
          },
          required: ['name', 'gross', 'startMonth'],
          create: (v) => mutations.create.mutateAsync(incomeDraftInput(v)),
        }}
        footer={
          totals && (
            <span className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
              <span>
                {t('planner.incomes.totals.gross')}{' '}
                <strong className="text-foreground tabular">
                  {formatMoney(totals.grossIncome, base)}
                </strong>
              </span>
              <span>
                {t('planner.incomes.totals.deductions')}{' '}
                <strong className="text-foreground tabular">
                  {formatMoney(totals.deductions, base)}
                </strong>
              </span>
              <span>
                {t('planner.incomes.totals.net')}{' '}
                <strong className="text-foreground tabular">
                  {formatMoney(totals.netIncome, base)}
                </strong>
              </span>
            </span>
          )
        }
        empty={t('planner.incomes.empty')}
      />
    </>
  );
}
