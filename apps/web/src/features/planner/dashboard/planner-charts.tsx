import type {
  BudgetBreakdownDto,
  ChartId,
  PlannerTrendPointDto,
  PurchaseDto,
} from '@homehub/shared';
import { Trans } from 'react-i18next';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatMoney } from '@/lib/format';
import { centsToNumber, fromCents } from '@/lib/money';
import { categoryLabel, categorySlot, OTHER_COLOR } from '../labels';
import { DataTable, Legend, TimeChart, type Series } from './chart-parts';
import type { ChartSetting } from './chart-card';
import {
  balanceStats,
  percentOf,
  savingsTotal,
  seriesRows,
  structure,
  topCategories,
  trendRows,
} from './chart-data';
import { t } from '@/i18n';

/** What every chart of the dashboard draws from. */
export interface ChartView {
  /** The last twelve months up to the selected one. */
  points: PlannerTrendPointDto[];
  currency: string;
  /** Selected period (highlighted on time charts when longer than a month). */
  from: string;
  to: string;
  breakdown: BudgetBreakdownDto[];
  purchases: PurchaseDto[];
}

function NoSpending() {
  return (
    <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">
      {t('planner.dashboard.charts.noSpending')}
    </p>
  );
}

function StructureChart({ type, view }: { type: string; view: ChartView }) {
  const currency = view.currency;
  const { items: shares, total } = structure(view.breakdown);
  const items = shares.map((item) => ({
    ...item,
    label: item.kind === 'purchases' ? t('planner.breakdown.purchases') : categoryLabel(item.key),
    color: categorySlot(item.key),
  }));
  if (items.length === 0) return <NoSpending />;

  if (type === 'donut') {
    // Categories without a color slot fold into one neutral "Другое" segment.
    const withSlot = items.filter((i) => i.color);
    const rest = items.filter((i) => !i.color).reduce((s, i) => s + i.cents, 0n);
    const slices = [
      ...withSlot,
      ...(rest > 0n
        ? [{ key: 'OTHER_FOLD', label: t('common.other'), cents: rest, color: OTHER_COLOR }]
        : []),
    ].map((s) => ({ ...s, value: centsToNumber(s.cents) }));
    return (
      <div className="grid items-center gap-4 sm:grid-cols-[12rem_1fr]">
        <div className="mx-auto size-44" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={slices}
                dataKey="value"
                nameKey="label"
                innerRadius="62%"
                outerRadius="100%"
                paddingAngle={1}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {slices.map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatMoney(Number(v ?? 0), currency)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="space-y-1.5 text-sm">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: s.color }}
                aria-hidden
              />
              <span className="truncate">{s.label}</span>
              <span className="ml-auto tabular">{formatMoney(fromCents(s.cents), currency)}</span>
              <span className="w-10 text-right text-xs text-muted-foreground tabular">
                {percentOf(s.cents, total)}%
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{item.label}</span>
            <span className="shrink-0 tabular">
              {formatMoney(fromCents(item.cents), currency)}
              <span className="ml-2 inline-block w-9 text-right text-xs text-muted-foreground">
                {item.percent}%
              </span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full bg-[var(--cat-1)]"
              style={{ width: `${item.barPercent}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function PurchasesChart({ type, view }: { type: string; view: ChartView }) {
  if (type === 'list') {
    return view.purchases.length === 0 ? (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {t('planner.dashboard.charts.noPurchases')}
      </p>
    ) : (
      <ul className="divide-y text-sm">
        {view.purchases.map((p) => (
          <li key={p.id} className="flex items-center gap-2 py-2">
            <span className="truncate">{p.title}</span>
            {p.status === 'PURCHASED' && (
              <span className="text-xs text-income">{t('planner.dashboard.charts.purchased')}</span>
            )}
            <span className="ml-auto tabular">{formatMoney(p.budgetAmount, p.currency)}</span>
          </li>
        ))}
      </ul>
    );
  }
  const series = [
    {
      key: 'purchases',
      label: t('planner.dashboard.charts.purchasesSeries'),
      color: 'var(--cat-2)',
    },
  ];
  const rows = seriesRows(view.points, 'purchases');
  return (
    <>
      <TimeChart
        type="bar"
        rows={rows}
        series={series}
        currency={view.currency}
        highlight={{ from: view.from, to: view.to }}
      />
      <DataTable
        caption={t('planner.charts.purchases')}
        rows={rows}
        series={series}
        currency={view.currency}
      />
    </>
  );
}

/** Spending by the largest categories per month; the rest folds into «Другое». */
function CategoriesChart({ type, view }: { type: string; view: ChartView }) {
  const { top, folded, rows } = topCategories(view.points);
  if (top.length === 0) return <NoSpending />;
  const series: Series[] = [
    ...top.map((key, index) => ({
      key,
      label: categoryLabel(key),
      color: categorySlot(key) ?? `var(--cat-${index + 3})`,
    })),
    ...(folded ? [{ key: 'OTHER_FOLD', label: t('common.other'), color: OTHER_COLOR }] : []),
  ];
  return (
    <div className="space-y-2">
      <Legend series={series} />
      <TimeChart
        type={type === 'area' ? 'area' : 'bar'}
        stacked
        rows={rows}
        series={series}
        currency={view.currency}
        highlight={{ from: view.from, to: view.to }}
      />
      <DataTable
        caption={t('planner.charts.categories')}
        rows={rows}
        series={series}
        currency={view.currency}
      />
    </div>
  );
}

function TrendChart({ type, view }: { type: string; view: ChartView }) {
  const series = [
    {
      key: 'netIncome',
      label: t('planner.dashboard.charts.netIncome'),
      color: 'var(--chart-income)',
    },
    {
      key: 'spending',
      label: t('planner.dashboard.charts.spending'),
      color: 'var(--chart-expense)',
    },
    { key: 'savingsTarget', label: t('common.savings'), color: 'var(--chart-savings)' },
  ];
  const rows = trendRows(view.points);
  return (
    <div className="space-y-2">
      <Legend series={series} />
      <TimeChart
        type={type}
        rows={rows}
        series={series}
        currency={view.currency}
        highlight={{ from: view.from, to: view.to }}
      />
      <DataTable
        caption={t('planner.dashboard.charts.trendCaption')}
        rows={rows}
        series={series}
        currency={view.currency}
      />
    </div>
  );
}

function BalanceChart({ type, view }: { type: string; view: ChartView }) {
  const { currency } = view;
  const series = [
    { key: 'free', label: t('planner.dashboard.charts.free'), color: 'var(--chart-income)' },
  ];
  const rows = seriesRows(view.points, 'free');
  const { average, negativeMonths } = balanceStats(view.points);
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        <Trans
          i18nKey="planner.dashboard.charts.balanceAverage"
          values={{ amount: formatMoney(average, currency, { signed: true }) }}
          components={{ value: <span className="font-medium text-foreground tabular" /> }}
        />
        {negativeMonths > 0 && (
          <span className="text-destructive">
            {' · '}
            {t('planner.dashboard.charts.negativeMonths', { months: negativeMonths })}
          </span>
        )}
      </p>
      <TimeChart
        type={type}
        rows={rows}
        series={series}
        currency={currency}
        highlight={{ from: view.from, to: view.to }}
        signColors={type === 'bar' ? ['var(--chart-savings)', 'var(--chart-expense)'] : undefined}
      />
      <DataTable
        caption={t('planner.charts.balance')}
        rows={rows}
        series={series}
        currency={currency}
      />
    </div>
  );
}

function SavingsChart({ type, view }: { type: string; view: ChartView }) {
  const { currency } = view;
  const series = [
    {
      key: 'savingsTarget',
      label: t('planner.dashboard.charts.savingsTarget'),
      color: 'var(--chart-savings)',
    },
  ];
  const rows = seriesRows(view.points, 'savingsTarget');
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {t('planner.dashboard.charts.savingsTotal', { months: rows.length })}{' '}
        <span className="font-medium text-foreground tabular">
          {formatMoney(savingsTotal(view.points), currency)}
        </span>
      </p>
      <TimeChart
        type={type}
        rows={rows}
        series={series}
        currency={currency}
        highlight={{ from: view.from, to: view.to }}
      />
      <DataTable
        caption={t('planner.dashboard.charts.savingsCaption')}
        rows={rows}
        series={series}
        currency={currency}
      />
    </div>
  );
}

const CHARTS = {
  trend: TrendChart,
  structure: StructureChart,
  categories: CategoriesChart,
  balance: BalanceChart,
  savings: SavingsChart,
  purchases: PurchasesChart,
} satisfies Record<ChartId, unknown>;

export function PlannerChart({ setting, view }: { setting: ChartSetting; view: ChartView }) {
  const Chart = CHARTS[setting.id];
  return <Chart type={setting.type} view={view} />;
}
