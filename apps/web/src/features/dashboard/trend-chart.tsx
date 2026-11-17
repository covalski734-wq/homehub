import type { DailyPointDto, MonthlyPointDto } from '@homehub/shared';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { formatDay, formatMoney, formatMonth, formatShortMonth } from '@/lib/format';
import { t } from '@/i18n';

type View = 'months' | 'days';

interface ChartRow {
  key: string;
  label: string;
  fullLabel: string;
  income: number;
  expense: number;
}

const SERIES = [
  { key: 'income', label: t('common.incomes'), color: 'var(--chart-income)' },
  { key: 'expense', label: t('common.expenses'), color: 'var(--chart-expense)' },
] as const;

function ChartTooltip({
  active,
  payload,
  currency,
}: Pick<TooltipContentProps<ValueType, NameType>, 'active' | 'payload'> & { currency: string }) {
  const row = payload?.[0]?.payload as ChartRow | undefined;
  if (!active || !payload || !row) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{row.fullLabel}</p>
      {payload.map((item) => (
        <p key={String(item.dataKey)} className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: item.color }}
            aria-hidden
          />
          <span className="text-muted-foreground">
            {SERIES.find((s) => s.key === item.dataKey)?.label}
          </span>
          <span className="ml-auto pl-3 font-medium tabular">
            {formatMoney(Number(item.value), currency)}
          </span>
        </p>
      ))}
    </div>
  );
}

export function TrendChart({
  currency,
  trend,
  daily,
}: {
  currency: string;
  trend: MonthlyPointDto[];
  daily: DailyPointDto[];
}) {
  const [view, setView] = useState<View>('months');

  const rows: ChartRow[] =
    view === 'months'
      ? trend
          .filter((p) => p.currency === currency)
          .map((p) => ({
            key: p.month,
            label: formatShortMonth(p.month),
            fullLabel: formatMonth(p.month),
            income: Number(p.income),
            expense: Number(p.expense),
          }))
      : daily
          .filter((p) => p.currency === currency)
          .map((p) => ({
            key: p.date,
            label: String(Number(p.date.slice(8))),
            fullLabel: formatDay(p.date),
            income: Number(p.income),
            expense: Number(p.expense),
          }));
  const series = view === 'months' ? SERIES : SERIES.filter((s) => s.key === 'expense');

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <CardTitle>{t('dashboard.trend.title')}</CardTitle>
          <ul
            className="mt-1.5 flex gap-3 text-xs text-muted-foreground"
            aria-label={t('common.legend')}
          >
            {series.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
                {s.label}
              </li>
            ))}
          </ul>
        </div>
        <SegmentedControl
          label={t('dashboard.trend.view.label')}
          value={view}
          onChange={setView}
          options={[
            { value: 'months', label: t('dashboard.trend.view.months') },
            { value: 'days', label: t('dashboard.trend.view.days') },
          ]}
          className="w-52"
        />
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="flex h-56 items-center justify-center text-sm text-muted-foreground">
            {t('dashboard.trend.noData', { currency })}
          </p>
        ) : (
          <div className="h-56" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                barGap={2}
                barCategoryGap={view === 'months' ? '28%' : '18%'}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  interval="preserveStartEnd"
                  minTickGap={8}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                  tickFormatter={(value: number) => formatMoney(value, currency, { compact: true })}
                />
                <Tooltip
                  cursor={{ fill: 'var(--muted)', opacity: 0.6 }}
                  content={({ active, payload }) => (
                    <ChartTooltip active={active} payload={payload} currency={currency} />
                  )}
                />
                {series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    fill={s.color}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={28}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="sr-only">
          <table>
            <caption>{t('dashboard.trend.tableCaption', { currency })}</caption>
            <thead>
              <tr>
                <th>{t('common.period')}</th>
                {series.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>{row.fullLabel}</td>
                  {series.map((s) => (
                    <td key={s.key}>{formatMoney(row[s.key], currency)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
