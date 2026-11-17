import {
  scenarioMonthSchema,
  type ScenarioDto,
  type ScenarioKind,
  type ScenariosDto,
} from '@homehub/shared';
import { TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState } from '@/components/states/states';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { formatMoney, formatShortMonth, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useScenarioMonthMutation, useScenarioMutation, useScenarios } from './api';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { isNegative, isPositive } from '../savings/model';
import { t } from '@/i18n';

const TITLES: Record<ScenarioKind, string> = {
  PESSIMISTIC: t('household.scenarios.kind.PESSIMISTIC'),
  BASE: t('household.scenarios.kind.BASE'),
  OPTIMISTIC: t('household.scenarios.kind.OPTIMISTIC'),
};

function PercentInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(String(Number(value)));
  const commit = () => {
    const normalized = text.replace(',', '.').trim();
    if (normalized !== String(Number(value)) && /^-?\d{1,3}(\.\d{1,2})?$/.test(normalized))
      onCommit(normalized);
  };
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <span className="flex items-center gap-1">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          inputMode="decimal"
          className="h-8 w-20 text-right tabular"
        />
        %
      </span>
    </label>
  );
}

function ScenarioCard({
  scenario,
  base,
  onChange,
}: {
  scenario: ScenarioDto;
  base: string;
  onChange: (income: string, expenses: string) => void;
}) {
  const deficit = scenario.totals.deficit;
  const hasDeficit = isPositive(deficit);
  const Icon = scenario.kind === 'PESSIMISTIC' ? TrendingDown : TrendingUp;
  return (
    <Card className="space-y-3 p-4" role="region" aria-label={TITLES[scenario.kind]}>
      <h2 className="flex items-center gap-2 font-semibold">
        <Icon className="size-4 text-muted-foreground" aria-hidden /> {TITLES[scenario.kind]}
      </h2>
      {scenario.kind === 'BASE' ? (
        <p className="text-xs text-muted-foreground">{t('household.scenarios.card.baseHint')}</p>
      ) : (
        <div className="flex gap-3">
          <PercentInput
            key={`i${scenario.income}`}
            label={t('common.incomes')}
            value={scenario.income}
            onCommit={(v) => onChange(v, scenario.expenses)}
          />
          <PercentInput
            key={`e${scenario.expenses}`}
            label={t('common.expenses')}
            value={scenario.expenses}
            onCommit={(v) => onChange(scenario.income, v)}
          />
        </div>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">
            {t('household.scenarios.card.netIncome')}
          </dt>
          <dd className="font-medium tabular">{formatMoney(scenario.totals.netIncome, base)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('common.expenses')}</dt>
          <dd className="font-medium tabular">{formatMoney(scenario.totals.expenses, base)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {t('household.scenarios.card.plannedSavings')}
          </dt>
          <dd className="font-medium tabular text-income">
            {formatMoney(scenario.totals.savings, base)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t('household.scenarios.card.deficit')}</dt>
          <dd className={cn('font-medium tabular', hasDeficit && 'text-destructive')}>
            {formatMoney(deficit, base)}
          </dd>
        </div>
      </dl>
      {scenario.funds.length > 0 && (
        <ul className="space-y-1 border-t pt-2 text-sm">
          {scenario.funds.map((f) => (
            <li key={f.potId} className="flex items-baseline gap-2">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: f.color ?? 'var(--income)' }}
                aria-hidden
              />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular">
                {formatMoney(f.projected, f.currency)}
                {f.target &&
                  (f.reachMonth
                    ? ` · ${t('household.scenarios.card.goalMonth', { month: formatShortMonth(f.reachMonth) })}`
                    : ` · ${t('household.scenarios.card.goalNotReached')}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {hasDeficit && (
        <p className="flex gap-1.5 text-xs text-destructive">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {t('household.scenarios.card.deficitWarning')}
        </p>
      )}
    </Card>
  );
}

/** Months with their own percentages (a bonus month, a month without work, a big expense). */
function MonthsEditor({ data, from, count }: { data: ScenariosDto; from: string; count: number }) {
  const save = useScenarioMonthMutation(from, count);
  const [kind, setKind] = useState<'PESSIMISTIC' | 'OPTIMISTIC'>('PESSIMISTIC');
  const months = data.scenarios[0]!.months.map((m) => m.month);
  const [month, setMonth] = useState(months[0] ?? from);
  const [income, setIncome] = useState('');
  const [expenses, setExpenses] = useState('0');
  // Only the two adjustable scenarios have months of their own.
  const custom = data.scenarios.flatMap(({ kind, months }) =>
    kind === 'BASE' ? [] : months.filter((m) => m.custom).map((m) => ({ kind, ...m })),
  );
  const run = (input: Parameters<typeof save.mutate>[0], done?: () => void) =>
    save.mutate(input, { onSuccess: () => done?.() });
  return (
    <Card
      className="space-y-3 p-4"
      role="region"
      aria-label={t('household.scenarios.months.title')}
    >
      <div>
        <h2 className="font-semibold">{t('household.scenarios.months.title')}</h2>
        <p className="text-xs text-muted-foreground">
          {t('household.scenarios.months.description')}
        </p>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run({ kind, month, income: income || '0', expenses: expenses || '0' }, () =>
            setIncome(''),
          );
        }}
      >
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('household.scenarios.months.scenario')}
          <NativeSelect
            value={kind}
            onChange={(e) => setKind(scenarioMonthSchema.shape.kind.parse(e.target.value))}
          >
            <option value="PESSIMISTIC">{TITLES.PESSIMISTIC}</option>
            <option value="OPTIMISTIC">{TITLES.OPTIMISTIC}</option>
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('common.month')}
          <NativeSelect value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('household.scenarios.months.incomePercent')}
          <Input
            value={income}
            onChange={(e) => setIncome(e.target.value)}
            inputMode="decimal"
            placeholder="-100"
            className="h-9 w-24 text-right tabular"
          />
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          {t('household.scenarios.months.expensesPercent')}
          <Input
            value={expenses}
            onChange={(e) => setExpenses(e.target.value)}
            inputMode="decimal"
            className="h-9 w-24 text-right tabular"
          />
        </label>
        <Button type="submit" variant="outline" disabled={save.isPending}>
          {t('household.scenarios.months.submit')}
        </Button>
      </form>
      {custom.length > 0 && (
        <ul className="divide-y text-sm">
          {custom.map((m) => (
            <li key={`${m.kind}:${m.month}`} className="flex items-center gap-2 py-1.5">
              <span className="flex-1">
                {TITLES[m.kind]} · {formatMonth(m.month)}
              </span>
              <span className="text-xs text-muted-foreground tabular">
                {t('household.scenarios.months.percents', {
                  income: Number(m.incomePercent),
                  expenses: Number(m.expensesPercent),
                })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={save.isPending}
                onClick={() =>
                  run({
                    kind: m.kind,
                    month: m.month,
                    income: null,
                    expenses: null,
                  })
                }
              >
                {t('household.scenarios.months.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Pessimistic, base and optimistic months side by side: savings, free money, deficits, goals. */
export default function ScenariosPage() {
  const { month } = useMonth();
  const [months, setMonths] = useState<'6' | '12' | '24'>('12');
  const count = Number(months);
  const scenarios = useScenarios(month, count);
  const update = useScenarioMutation(month, count);
  const header = (
    <PageHeader
      title={t('household.scenarios.title')}
      description={t('household.scenarios.description')}
      actions={
        <>
          <MonthSwitcher />
          <SegmentedControl
            label={t('common.period')}
            value={months}
            onChange={setMonths}
            options={[
              { value: '6', label: t('household.scenarios.horizon.m6') },
              { value: '12', label: t('household.scenarios.horizon.m12') },
              { value: '24', label: t('household.scenarios.horizon.m24') },
            ]}
          />
        </>
      }
    />
  );
  if (scenarios.isPending)
    return (
      <>
        {header}
        <Skeleton className="h-64 w-full rounded-xl" />
      </>
    );
  if (scenarios.isError || !scenarios.data)
    return (
      <>
        {header}
        <ErrorState error={scenarios.error} onRetry={() => void scenarios.refetch()} />
      </>
    );
  const data = scenarios.data;
  const base = data.baseCurrency;
  const change = (kind: ScenarioKind, income: string, expenses: string) =>
    kind !== 'BASE' && update.mutate({ kind, income, expenses });
  const [pessimistic, baseline, optimistic] = data.scenarios;
  return (
    <>
      {header}
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          {data.scenarios.map((s) => (
            <ScenarioCard
              key={s.kind}
              scenario={s}
              base={base}
              onChange={(income, expenses) => change(s.kind, income, expenses)}
            />
          ))}
        </div>
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <caption className="px-4 pt-3 text-left text-xs text-muted-foreground">
              {t('household.scenarios.table.caption', {
                month: formatMonth(data.from).toLowerCase(),
              })}
            </caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-normal">{t('common.month')}</th>
                {data.scenarios.map((s) => (
                  <th key={s.kind} className="px-3 py-2 text-right font-normal" colSpan={2}>
                    {TITLES[s.kind]}
                  </th>
                ))}
              </tr>
              <tr className="text-[11px]">
                <th />
                {data.scenarios.map((s) => [
                  <th key={`${s.kind}s`} className="px-3 pb-1 text-right font-normal">
                    {t('household.scenarios.table.saving')}
                  </th>,
                  <th key={`${s.kind}f`} className="px-3 pb-1 text-right font-normal">
                    {t('household.scenarios.table.free')}
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody className="tabular">
              {baseline!.months.map((m, i) => (
                <tr key={m.month} className="border-t">
                  <td className="px-4 py-1.5">{formatShortMonth(m.month)}</td>
                  {[pessimistic!, baseline!, optimistic!].map((s) => {
                    const row = s.months[i]!;
                    return [
                      <td
                        key={`${s.kind}s`}
                        className="px-3 py-1.5 text-right text-income"
                        title={
                          row.custom
                            ? t('household.scenarios.table.customMonth', {
                                income: Number(row.incomePercent),
                                expenses: Number(row.expensesPercent),
                              })
                            : undefined
                        }
                      >
                        {row.custom && <span className="mr-1 text-primary">●</span>}
                        {formatMoney(row.savings, base)}
                      </td>,
                      <td
                        key={`${s.kind}f`}
                        className={cn(
                          'px-3 py-1.5 text-right',
                          isNegative(row.free) && 'text-destructive',
                        )}
                      >
                        {formatMoney(row.free, base)}
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <MonthsEditor data={data} from={month} count={count} />
      </div>
    </>
  );
}
