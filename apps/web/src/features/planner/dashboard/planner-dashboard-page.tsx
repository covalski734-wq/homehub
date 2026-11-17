import {
  BASE_CURRENCIES,
  currentMonth,
  shiftMonth,
  type BaseCurrency,
  type DashboardLayout,
} from '@homehub/shared';
import { Settings2, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { useMonth } from '@/hooks/use-month';
import { formatFullDate, formatMonth } from '@/lib/format';
import {
  useDashboardLayout,
  useMonthBudget,
  usePlannerSettings,
  usePurchases,
  useRates,
  useSaveDashboardLayout,
  useTrend,
  useUpdatePlannerSettings,
} from '../api';
import { BudgetSummary } from './budget-summary';
import { Insights, MonthsTable, PaymentsList, PurchasesList } from './dashboard-panels';
import { parsePeriod, PERIODS, summarize, type PeriodLength } from './period';
import { ChartCard, type ChartSetting } from './chart-card';
import { PlannerChart, type ChartView } from './planner-charts';
import { RemainingCard } from './remaining-card';
import { t } from '@/i18n';

function RatesNote() {
  const rates = useRates();
  if (!rates.data || rates.data.rates.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('planner.dashboard.rates.missing')}{' '}
        <Link className="underline underline-offset-4" to="/settings">
          {t('planner.dashboard.rates.update')}
        </Link>
      </p>
    );
  }
  const latest = rates.data.rates
    .map((r) => r.effectiveDate)
    .sort()
    .at(-1);
  return (
    <p className="text-xs text-muted-foreground">
      {t('planner.dashboard.rates.asOf', { date: latest ? formatFullDate(latest) : '—' })}{' '}
      {rates.data.rates.map((r) => `${r.currency} ${r.rate.replace('.', ',')}`).join(' · ')}
      {rates.data.stale && (
        <span className="text-destructive"> {t('planner.dashboard.rates.stale')}</span>
      )}
    </p>
  );
}

const PERIOD_OPTIONS = PERIODS.map((n) => ({
  value: String(n),
  label:
    n === 1
      ? t('common.month')
      : n === 12
        ? t('planner.dashboard.period.year')
        : t('planner.dashboard.period.months', { months: n }),
}));

export default function PlannerDashboardPage() {
  const { month } = useMonth();
  const [params, setParams] = useSearchParams();
  const length = parsePeriod(params.get('period'));
  const setLength = (next: PeriodLength) =>
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        if (next === 1) updated.delete('period');
        else updated.set('period', String(next));
        return updated;
      },
      { replace: true },
    );
  // One URL update: two separate ones would each start from the old URL and undo the other.
  const openMonth = (next: string) =>
    setParams(
      (prev) => {
        const updated = new URLSearchParams(prev);
        updated.delete('period');
        if (next === currentMonth()) updated.delete('month');
        else updated.set('month', next);
        return updated;
      },
      { replace: true },
    );
  const budget = useMonthBudget(month);
  // Twelve months for the charts, plus the previous period of the same length for comparison.
  const trend = useTrend(month, length === 12 ? 24 : 12);
  const purchases = usePurchases();
  const settings = usePlannerSettings();
  const updateSettings = useUpdatePlannerSettings();
  const layout = useDashboardLayout();
  const saveLayout = useSaveDashboardLayout();
  const [customizing, setCustomizing] = useState(false);
  const search = `?month=${month}`;
  const from = shiftMonth(month, -(length - 1));

  const period = useMemo(() => {
    if (!trend.data) return null;
    const points = trend.data.points;
    return {
      current: summarize(points, month, length),
      previous: summarize(points, shiftMonth(month, -length), length),
      window: points.slice(-12),
    };
  }, [trend.data, month, length]);

  const title =
    length === 1
      ? t('planner.dashboard.title.month', { month: formatMonth(month).toLowerCase() })
      : t('planner.dashboard.title.range', {
          from: formatMonth(from).toLowerCase(),
          to: formatMonth(month).toLowerCase(),
        });

  const header = (
    <PageHeader
      title={title}
      actions={
        <>
          <MonthSwitcher />
          <SegmentedControl
            label={t('common.period')}
            value={String(length)}
            onChange={(next) => setLength(parsePeriod(next))}
            options={PERIOD_OPTIONS}
            className="w-full sm:w-72"
          />
          {settings.data && (
            <SegmentedControl
              label={t('planner.dashboard.displayCurrency')}
              value={settings.data.baseCurrency}
              onChange={(baseCurrency: BaseCurrency) => updateSettings.mutate({ baseCurrency })}
              options={BASE_CURRENCIES.map((c) => ({ value: c, label: c }))}
              className="w-28"
            />
          )}
        </>
      }
    />
  );

  if (budget.isPending) {
    return (
      <>
        {header}
        <div className="space-y-4" role="status" aria-label={t('planner.dashboard.loading')}>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </>
    );
  }
  if (budget.isError)
    return (
      <>
        {header}
        <ErrorState error={budget.error} onRetry={() => void budget.refetch()} />
      </>
    );

  const data = budget.data;
  const isEmpty =
    data.incomes.length === 0 && data.recurring.length === 0 && data.purchases.length === 0;
  if (isEmpty) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<Sparkles />}
            title={t('planner.dashboard.empty.title')}
            description={t('planner.dashboard.empty.description')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild>
                  <Link to={{ pathname: '/incomes', search }}>
                    {t('planner.dashboard.empty.addIncomes')}
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to={{ pathname: '/recurring', search }}>
                    {t('planner.dashboard.empty.recurring')}
                  </Link>
                </Button>
              </div>
            }
          />
        </Card>
      </>
    );
  }

  const periodPurchases = (purchases.data ?? []).filter(
    (p) => p.budgetMonth !== null && p.budgetMonth >= from && p.budgetMonth <= month,
  );
  const currency = trend.data?.baseCurrency ?? data.baseCurrency;
  const view: ChartView | null = period && {
    points: period.window,
    currency,
    from,
    to: month,
    breakdown: length === 1 ? data.breakdown : period.current.breakdown,
    purchases: periodPurchases,
  };

  const charts = layout.data?.charts ?? [];
  // Shown at once; the mutation puts the previous layout back (with a toast) if saving fails.
  const saveLayoutPart = (part: Partial<DashboardLayout>) =>
    saveLayout.mutate({ charts, remaining: layout.data?.remaining, ...part });
  const persist = (next: ChartSetting[]) => saveLayoutPart({ charts: next });
  const shown = customizing ? charts : charts.filter((c) => c.visible);

  return (
    <>
      {header}
      <div className="space-y-4">
        {length === 1 && layout.data && (
          <RemainingCard
            budget={data}
            remaining={layout.data.remaining}
            onRemainingChange={(remaining) => saveLayoutPart({ remaining })}
            search={search}
          />
        )}
        {length === 1 ? (
          <BudgetSummary
            totals={data.totals}
            previous={period?.previous.totals}
            currency={data.baseCurrency}
            length={1}
            monthBudget={data}
          />
        ) : period ? (
          <BudgetSummary
            totals={period.current.totals}
            previous={period.previous.months.length === length ? period.previous.totals : undefined}
            currency={currency}
            length={length}
          />
        ) : (
          <Skeleton className="h-36 w-full rounded-xl" />
        )}

        {period && (
          <Insights
            summary={
              length === 1 ? { ...period.current, breakdown: data.breakdown } : period.current
            }
            window={period.window}
            currency={currency}
            monthBudget={length === 1 ? data : undefined}
          />
        )}

        <div
          className={cn(
            'grid items-start gap-4',
            length === 1 ? 'lg:grid-cols-2' : 'lg:grid-cols-[3fr_2fr]',
          )}
        >
          {length === 1 ? (
            <PaymentsList budget={data} search={search} />
          ) : (
            period && (
              <MonthsTable months={period.current.months} currency={currency} onOpen={openMonth} />
            )
          )}
          <PurchasesList
            purchases={length === 1 ? data.purchases : periodPurchases}
            title={
              length === 1
                ? t('planner.dashboard.purchases.monthTitle')
                : t('planner.dashboard.purchases.periodTitle')
            }
            empty={
              length === 1
                ? t('planner.dashboard.purchases.monthEmpty')
                : t('planner.dashboard.purchases.periodEmpty')
            }
            search={search}
            showMonth={length > 1}
          />
        </div>

        <section aria-labelledby="charts-heading" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="charts-heading" className="text-sm font-semibold">
              {t('planner.dashboard.charts.title')}
            </h2>
            <Button
              variant={customizing ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={customizing}
              onClick={() => setCustomizing((v) => !v)}
            >
              <Settings2 />{' '}
              {customizing
                ? t('planner.dashboard.charts.done')
                : t('planner.dashboard.charts.customize')}
            </Button>
          </div>
          {customizing && (
            <p className="text-xs text-muted-foreground">
              {t('planner.dashboard.charts.customizeHint')}
            </p>
          )}
          {shown.length === 0 && !customizing && (
            <p className="text-sm text-muted-foreground">
              {t('planner.dashboard.charts.allHidden')}
            </p>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            {shown.map((setting) => {
              const index = charts.findIndex((c) => c.id === setting.id);
              return (
                <ChartCard
                  key={setting.id}
                  setting={setting}
                  customizing={customizing}
                  isFirst={index === 0}
                  isLast={index === charts.length - 1}
                  onChange={(next) => persist(charts.map((c) => (c.id === next.id ? next : c)))}
                  onMove={(delta) => {
                    const next = [...charts];
                    const [item] = next.splice(index, 1);
                    if (item) next.splice(index + delta, 0, item);
                    persist(next);
                  }}
                >
                  {view ? (
                    <PlannerChart setting={setting} view={view} />
                  ) : (
                    <Skeleton className="h-60" />
                  )}
                </ChartCard>
              );
            })}
          </div>
        </section>

        <RatesNote />
      </div>
    </>
  );
}
