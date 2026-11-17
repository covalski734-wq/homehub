import type { MonthBudgetDto } from '@homehub/shared';
import { ArrowRight, Landmark, Scale, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatMoney, formatMonth } from '@/lib/format';
import { noticeText, ownerName } from '@/lib/system-texts';
import { cn } from '@/lib/utils';
import { categoryLabel } from '../planner/labels';
import { useWealth } from './api';
import { capitalShare, hasMoney, planFactBar, planFactDiff, reservedTotal } from './model';
import { OwnersBreakdown } from './shares';
import { isNegative, isPositive } from '../savings/model';
import { t } from '@/i18n';

const linkClass =
  'inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-lg font-semibold tracking-tight tabular sm:text-xl', tone)}>
        {value}
      </dd>
      {hint && <dd className="truncate text-[11px] text-muted-foreground">{hint}</dd>}
    </div>
  );
}

/**
 * How much the household has and where: capital (each zloty once), free vs set aside in funds,
 * by member, and the goals' progress.
 */
export function WealthCard({ month, search }: { month: string; search: string }) {
  const wealth = useWealth(month);
  if (wealth.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (!wealth.data) return null;
  const w = wealth.data;
  const base = w.baseCurrency;
  const owners = w.owners.filter(hasMoney);
  return (
    <Card className="overflow-hidden" aria-labelledby="wealth-heading">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 id="wealth-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <Landmark className="size-4 text-muted-foreground" aria-hidden />{' '}
          {t('household.wealth.title')}
        </h2>
        <span className="flex gap-3">
          <Link to="/accounts" className={linkClass}>
            {t('common.accounts')} <ArrowRight className="size-3" aria-hidden />
          </Link>
          <Link to={{ pathname: '/savings', search }} className={linkClass}>
            {t('household.wealth.funds')} <ArrowRight className="size-3" aria-hidden />
          </Link>
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-px border-y bg-border sm:grid-cols-4">
        <Stat
          label={t('household.wealth.total')}
          value={formatMoney(w.capital, base)}
          hint={t('household.wealth.totalHint')}
        />
        <Stat
          label={t('household.wealth.free')}
          value={formatMoney(w.free, base)}
          hint={t('household.wealth.freeHint')}
          tone={isNegative(w.free) ? 'text-destructive' : undefined}
        />
        <Stat
          label={t('household.wealth.reserved')}
          value={formatMoney(reservedTotal(w.reserved, w.outside), base)}
          hint={
            isPositive(w.outside)
              ? t('household.wealth.outsideHint', { amount: formatMoney(w.outside, base) })
              : t('household.wealth.reservedHint')
          }
        />
        <Stat
          label={t('household.wealth.investments')}
          value={formatMoney(w.investments, base)}
          hint={t('household.wealth.investmentsHint')}
        />
      </dl>

      {owners.length > 0 && isPositive(w.capital) && (
        <div className="space-y-2 px-4 py-3">
          <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            {owners.map((o) => (
              <span
                key={o.ownerId ?? 'joint'}
                style={{
                  width: `${capitalShare(o.total, w.capital)}%`,
                  backgroundColor: o.color,
                }}
              />
            ))}
          </div>
          <ul className="grid gap-1.5 text-sm sm:grid-cols-3">
            {owners.map((o) => (
              <li key={o.ownerId ?? 'joint'} className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: o.color }}
                  aria-hidden
                />
                <span className="truncate">{ownerName(o)}</span>
                <span className="ml-auto font-medium tabular">{formatMoney(o.total, base)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {w.goals.length > 0 && (
        <ul className="divide-y border-t" aria-label={t('household.wealth.goals')}>
          {w.goals.map((g) => (
            <li key={g.potId} className="px-4 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <span aria-hidden>{g.icon ?? '🎯'}</span>
                <span className="truncate font-medium">{g.name}</span>
                <span className="ml-auto shrink-0 tabular">
                  {formatMoney(g.balance, g.currency)}
                  {g.target && (
                    <span className="text-muted-foreground">
                      {' '}
                      / {formatMoney(g.target, g.currency)}
                    </span>
                  )}
                </span>
              </div>
              {g.progress !== null && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${g.progress}%`, backgroundColor: g.color ?? 'var(--income)' }}
                  />
                </div>
              )}
              <p className="mt-1 text-xs text-muted-foreground tabular">
                {[
                  isPositive(g.planned) &&
                    t('household.wealth.goalMonthProgress', {
                      deposited: formatMoney(g.deposited, g.currency),
                      planned: formatMoney(g.planned, g.currency),
                    }),
                  g.forecastMonth
                    ? t('household.wealth.goalForecast', {
                        month: formatMonth(g.forecastMonth).toLowerCase(),
                      })
                    : g.target && t('household.wealth.goalUnreachable'),
                  g.targetDate && t('household.wealth.goalWanted', { date: g.targetDate }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </li>
          ))}
        </ul>
      )}

      {w.warnings.length > 0 && (
        <ul className="space-y-1 border-t px-4 py-2 text-xs text-destructive">
          {w.warnings.map((warning, index) => (
            <li key={warning.code + index} className="flex gap-1.5">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> {noticeText(warning)}
            </li>
          ))}
        </ul>
      )}
      {w.missingRates.length > 0 && (
        <p className="border-t px-4 py-2 text-xs text-muted-foreground">
          {t('household.wealth.missingRates', { currencies: w.missingRates.join(', ') })}
        </p>
      )}
    </Card>
  );
}

function Bar({
  label,
  plan,
  fact,
  base,
}: {
  label: string;
  plan: string;
  fact: string;
  base: string;
}) {
  const bar = planFactBar(plan, fact);
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular">
          <span className="font-medium">{formatMoney(fact, base)}</span>
          <span className="text-xs text-muted-foreground"> / {formatMoney(plan, base)}</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-muted">
        {/* Plan is the hatched outline, fact the solid bar: plan is never shown as money. */}
        <div
          className="absolute inset-y-0 left-0 rounded-full border border-dashed border-muted-foreground/50"
          style={{ width: `${bar.planWidth}%` }}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 rounded-full',
            bar.over ? 'bg-expense' : 'bg-primary',
          )}
          style={{ width: `${bar.factWidth}%` }}
        />
      </div>
    </div>
  );
}

/** Plan against fact of the month: incomes, expenses (by category), savings; the plan's warnings. */
export function PlanFactCard({ budget, search }: { budget: MonthBudgetDto; search: string }) {
  const fact = budget.fact;
  const base = budget.baseCurrency;
  const warnings = budget.savingsPlan.warnings;
  if (!fact) return null;
  const rows = fact.rows.filter((r) => isPositive(r.plan) || isPositive(r.fact));
  return (
    <Card className="overflow-hidden" aria-labelledby="planfact-heading">
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 id="planfact-heading" className="flex items-center gap-1.5 text-sm font-semibold">
          <Scale className="size-4 text-muted-foreground" aria-hidden />
          {t('household.planFact.title', { month: formatMonth(budget.month).toLowerCase() })}
        </h2>
        <Link to={{ pathname: '/finances', search }} className={linkClass}>
          {t('common.operations')} <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>
      <div className="grid gap-3 px-4 pb-3 sm:grid-cols-3">
        <Bar
          label={t('common.incomes')}
          plan={fact.income.plan}
          fact={fact.income.fact}
          base={base}
        />
        <Bar
          label={t('common.expenses')}
          plan={fact.expenses.plan}
          fact={fact.expenses.fact}
          base={base}
        />
        <Bar
          label={t('common.savings')}
          plan={fact.savings.plan}
          fact={fact.savings.fact}
          base={base}
        />
      </div>
      {rows.length > 0 && (
        <details className="border-t">
          <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground hover:text-foreground">
            {t('household.planFact.byCategory')}
            {isPositive(fact.unplanned) &&
              ` · ${t('household.planFact.unplanned', { amount: formatMoney(fact.unplanned, base) })}`}
          </summary>
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-1 text-left font-normal">{t('common.category')}</th>
                <th className="px-2 py-1 text-right font-normal">{t('household.planFact.plan')}</th>
                <th className="px-2 py-1 text-right font-normal">{t('household.planFact.fact')}</th>
                <th className="px-4 py-1 text-right font-normal">{t('household.planFact.diff')}</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {rows.map((r) => {
                const diff = planFactDiff(r.plan, r.fact);
                return (
                  <tr key={r.key} className="border-t">
                    <td className="px-4 py-1.5">{categoryLabel(r.key)}</td>
                    <td className="px-2 py-1.5 text-right">{formatMoney(r.plan, base)}</td>
                    <td className="px-2 py-1.5 text-right">{formatMoney(r.fact, base)}</td>
                    <td
                      className={cn('px-4 py-1.5 text-right', isNegative(diff) && 'text-expense')}
                    >
                      {formatMoney(diff, base, { signed: true })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
      <OwnersBreakdown budget={budget} />
      {warnings.length > 0 && (
        <ul className="space-y-1 border-t px-4 py-2 text-xs text-destructive" role="status">
          {warnings.map((warning, index) => (
            <li key={warning.code + index} className="flex gap-1.5">
              <TriangleAlert className="size-3.5 shrink-0" aria-hidden /> {noticeText(warning)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
