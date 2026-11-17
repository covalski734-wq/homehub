import { Link } from 'react-router';
import type { BudgetTotalsDto, MonthBudgetDto } from '@homehub/shared';
import { ArrowDown, ArrowUp, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { validatePercent, normalizeAmount } from '@/components/editable-table/validators';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { divRound, fromCents, toCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useSetSavingsRate } from '../api';
import { percentOf, widthPercent } from './chart-data';
import { change } from './period';
import { t } from '@/i18n';

function SavingsRateInput({ budget }: { budget: MonthBudgetDto }) {
  const setRate = useSetSavingsRate(budget.month);
  const saved = String(Number(budget.savingsRate));
  const [text, setText] = useState(saved);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!focused && !error && text !== saved && !setRate.isPending) setText(saved);

  const commit = (value: string) => {
    const normalized = normalizeAmount(value);
    if (normalized === saved) return;
    const problem = validatePercent(normalized);
    setError(problem);
    if (problem) return;
    // The error stays next to the field; the toast comes from the global mutation handler.
    setRate.mutate(normalized, { onError: (e) => setError(errorMessage(e)) });
  };

  return (
    <div className="flex items-center gap-1.5">
      <label className="sr-only" htmlFor="savings-rate">
        {t('planner.dashboard.savingsRate.label')}
      </label>
      <div className="relative">
        <input
          id="savings-rate"
          inputMode="decimal"
          value={focused || error ? text : saved}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'savings-rate-error' : undefined}
          onFocus={() => setFocused(true)}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onBlur={(e) => {
            setFocused(false);
            commit(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setText(saved);
              setError(null);
              e.currentTarget.blur();
            }
          }}
          className="h-7 w-14 rounded-md border border-input bg-background pr-5 pl-1.5 text-right text-xs font-medium tabular outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/30 aria-[invalid=true]:border-destructive max-md:h-9 max-md:text-base"
        />
        <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-xs text-muted-foreground">
          %
        </span>
      </div>
      {setRate.isPending && (
        <Loader2
          className="size-3.5 animate-spin text-muted-foreground"
          aria-label={t('common.saving')}
        />
      )}
      {!budget.savingsRateIsDefault && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('planner.dashboard.savingsRate.reset')}
          title={t('planner.dashboard.savingsRate.reset')}
          onClick={() => setRate.mutate(null)}
        >
          <RotateCcw className="text-muted-foreground" />
        </Button>
      )}
      {error && (
        <span id="savings-rate-error" role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}

/** Change against the previous period; `upIsGood` decides the colour, the arrow shows the sign. */
function Delta({
  current,
  previous,
  upIsGood,
  against,
}: {
  current: string;
  previous?: string;
  upIsGood: boolean;
  against: string;
}) {
  const ratio = change(current, previous);
  if (ratio === null || Math.abs(ratio) < 0.005) return null;
  const up = ratio > 0;
  const Icon = up ? ArrowUp : ArrowDown;
  const percent = Math.min(Math.round(Math.abs(ratio) * 100), 999);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-[11px] font-medium tabular',
        up === upIsGood ? 'text-income' : 'text-expense',
      )}
      title={against}
    >
      <Icon className="size-3" aria-hidden />
      <span className="sr-only">
        {up ? t('planner.dashboard.delta.up') : t('planner.dashboard.delta.down')}
      </span>
      {percent}%<span className="sr-only"> {against}</span>
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  swatch,
  delta,
  emphasis,
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  swatch?: string;
  delta?: ReactNode;
  emphasis?: 'good' | 'bad';
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-0.5 bg-card px-3 py-2.5 sm:px-4',
        emphasis === 'bad' && 'bg-destructive/5',
      )}
    >
      <dt className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
        {swatch && (
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: swatch }}
            aria-hidden
          />
        )}
        {label}
      </dt>
      <dd
        className={cn(
          'truncate text-base font-semibold tracking-tight tabular sm:text-lg',
          emphasis === 'good' && 'text-income',
          emphasis === 'bad' && 'text-destructive',
        )}
      >
        {value}
      </dd>
      <dd className="flex min-h-4 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground tabular">
        {delta}
        {hint}
      </dd>
      {children}
    </div>
  );
}

/** Where the net income goes: regular payments, purchases, savings and what stays free. */
function AllocationBar({ totals, currency }: { totals: BudgetTotalsDto; currency: string }) {
  const free = toCents(totals.free);
  const parts = [
    {
      key: 'recurring',
      label: t('planner.dashboard.allocation.recurring'),
      value: toCents(totals.recurring),
      color: 'var(--cat-1)',
    },
    {
      key: 'purchases',
      label: t('planner.dashboard.allocation.purchases'),
      value: toCents(totals.purchases),
      color: 'var(--cat-2)',
    },
    {
      key: 'savings',
      label: t('common.savings'),
      value: toCents(totals.savingsTarget),
      color: 'var(--chart-savings)',
    },
    {
      key: 'free',
      label: t('planner.dashboard.allocation.free'),
      value: free > 0n ? free : 0n,
      color: 'var(--muted-foreground)',
    },
  ];
  const sum = parts.reduce((s, p) => s + p.value, 0n);
  if (toCents(totals.netIncome) <= 0n || sum <= 0n) return null;

  return (
    <figure className="border-t px-3 py-2.5 sm:px-4">
      <figcaption className="sr-only">{t('planner.dashboard.allocation.caption')}</figcaption>
      <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {parts
          .filter((p) => p.value > 0n)
          .map((p) => (
            <div
              key={p.key}
              style={{
                width: `${widthPercent(p.value, sum)}%`,
                backgroundColor: p.color,
                opacity: p.key === 'free' ? 0.35 : 1,
              }}
            />
          ))}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: p.color, opacity: p.key === 'free' ? 0.5 : 1 }}
              aria-hidden
            />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="font-medium tabular">{formatMoney(fromCents(p.value), currency)}</span>
            <span className="text-muted-foreground tabular">{percentOf(p.value, sum)}%</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * Totals of the selected period in one compact block: six figures with the change against the
 * previous period of the same length, and how the income is split.
 */
export function BudgetSummary({
  totals,
  previous,
  currency,
  length,
  monthBudget,
}: {
  totals: BudgetTotalsDto;
  previous?: BudgetTotalsDto;
  currency: string;
  length: number;
  /** The month budget (one-month period): savings rate input and missing rates. */
  monthBudget?: MonthBudgetDto;
}) {
  const overspent = toCents(totals.free) < 0n;
  const against =
    length === 1
      ? t('planner.dashboard.summary.againstPreviousMonth')
      : t('planner.dashboard.summary.againstPreviousMonths', { months: length });
  const perMonth = (value: string) =>
    length > 1
      ? t('planner.dashboard.summary.perMonth', {
          amount: formatMoney(fromCents(divRound(toCents(value), BigInt(length))), currency),
        })
      : undefined;
  const delta = (key: keyof BudgetTotalsDto, upIsGood: boolean) => (
    <Delta current={totals[key]} previous={previous?.[key]} upIsGood={upIsGood} against={against} />
  );

  return (
    <section
      aria-label={t('planner.dashboard.summary.label')}
      className={cn(
        'overflow-hidden rounded-xl border bg-card',
        overspent && 'border-destructive/40',
      )}
    >
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label={t('planner.dashboard.summary.netIncome')}
          value={formatMoney(totals.netIncome, currency)}
          hint={perMonth(totals.netIncome)}
          delta={delta('netIncome', true)}
          swatch="var(--chart-income)"
        />
        <Kpi
          label={t('planner.dashboard.summary.recurring')}
          value={formatMoney(totals.recurring, currency)}
          hint={perMonth(totals.recurring)}
          delta={delta('recurring', false)}
          swatch="var(--cat-1)"
        />
        <Kpi
          label={
            length === 1
              ? t('planner.dashboard.summary.monthPurchases')
              : t('planner.dashboard.summary.purchases')
          }
          value={formatMoney(totals.purchases, currency)}
          delta={delta('purchases', false)}
          swatch="var(--cat-2)"
        />
        <Kpi
          label={t('common.savings')}
          value={formatMoney(totals.savingsTarget, currency)}
          delta={delta('savingsTarget', true)}
          swatch="var(--chart-savings)"
        >
          {monthBudget &&
            (monthBudget.savingsPlan.source === 'FUNDS' ? (
              // Savings come from the fund plans (and in «весь остаток» mode, all money left).
              <Link
                to={{ pathname: '/savings', search: `?month=${monthBudget.month}` }}
                className="mt-1 block text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {Number(monthBudget.savingsPlan.unallocated) > 0
                  ? t('planner.dashboard.summary.byFundsUnallocated', {
                      amount: formatMoney(monthBudget.savingsPlan.unallocated, currency),
                    })
                  : t('planner.dashboard.summary.byFunds')}
              </Link>
            ) : (
              <SavingsRateInput key={monthBudget.month} budget={monthBudget} />
            ))}
        </Kpi>
        <Kpi
          label={t('planner.dashboard.summary.deductions')}
          value={formatMoney(totals.deductions, currency)}
          hint={t('planner.dashboard.summary.gross', {
            amount: formatMoney(totals.grossIncome, currency),
          })}
        />
        <Kpi
          label={t('planner.dashboard.summary.free')}
          value={formatMoney(totals.free, currency, { signed: true })}
          delta={delta('free', true)}
          emphasis={overspent ? 'bad' : 'good'}
        />
      </dl>
      <AllocationBar totals={totals} currency={currency} />
      {overspent && (
        <p className="flex items-start gap-1.5 border-t px-3 py-2 text-xs text-destructive sm:px-4">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {t('planner.dashboard.summary.overspent')}
        </p>
      )}
      {monthBudget && monthBudget.missingRates.length > 0 && (
        <p
          role="alert"
          className="flex items-center gap-1.5 border-t px-3 py-2 text-xs text-destructive sm:px-4"
        >
          <TriangleAlert className="size-3.5" aria-hidden />
          {t('planner.dashboard.summary.missingRates', {
            currencies: monthBudget.missingRates.join(', '),
          })}
        </p>
      )}
    </section>
  );
}
