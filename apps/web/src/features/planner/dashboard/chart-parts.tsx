import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCompactNumber, formatMoney, formatMonth, formatShortMonth } from '@/lib/format';
import { t } from '@/i18n';
import type { ChartRow } from './chart-data';

export interface Series {
  key: string;
  label: string;
  color: string;
}

const axisTick = { fill: 'var(--muted-foreground)', fontSize: 11 };

function MoneyTooltip({
  active,
  payload,
  label,
  currency,
  series,
}: {
  active?: boolean;
  payload?: readonly { dataKey?: unknown; value?: unknown }[];
  label?: unknown;
  currency: string;
  series: Series[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">
        {typeof label === 'string' && /^\d{4}-\d{2}$/.test(label)
          ? formatMonth(label)
          : String(label)}
      </p>
      {payload.map((item) => {
        const s = series.find((x) => x.key === item.dataKey);
        return (
          <p key={String(item.dataKey)} className="flex items-center gap-2">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: s?.color }}
              aria-hidden
            />
            <span className="text-muted-foreground">{s?.label}</span>
            <span className="ml-auto pl-3 font-medium tabular">
              {formatMoney(Number(item.value), currency)}
            </span>
          </p>
        );
      })}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul
      className="flex flex-wrap gap-3 text-xs text-muted-foreground"
      aria-label={t('common.legend')}
    >
      {series.map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/** Screen-reader table mirroring the chart, so no information depends on seeing the plot. */
export function DataTable({
  caption,
  rows,
  series,
  currency,
}: {
  caption: string;
  rows: ChartRow[];
  series: Series[];
  currency: string;
}) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
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
            <tr key={String(row.month)}>
              <td>{formatMonth(String(row.month))}</td>
              {series.map((s) => (
                <td key={s.key}>{formatMoney(Number(row[s.key] ?? 0), currency)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TimeChart({
  type,
  rows,
  series,
  currency,
  highlight,
  stacked,
  signColors,
}: {
  type: string;
  rows: ChartRow[];
  series: Series[];
  currency: string;
  highlight?: { from: string; to: string };
  stacked?: boolean;
  /** Bars of a single series coloured by sign (positive / negative). */
  signColors?: [string, string];
}) {
  const common = { data: rows, margin: { top: 4, right: 4, bottom: 0, left: 0 } };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey="month"
        tickFormatter={(m: string) => formatShortMonth(m)}
        tickLine={false}
        axisLine={false}
        tick={axisTick}
        interval="preserveStartEnd"
        minTickGap={8}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={64}
        tick={axisTick}
        // Without the currency (it is named in the legend/tooltip), so labels never get clipped.
        tickFormatter={(v: number) => formatCompactNumber(v)}
      />
      {highlight && highlight.from !== highlight.to && (
        <ReferenceArea
          x1={highlight.from}
          x2={highlight.to}
          fill="var(--muted-foreground)"
          fillOpacity={0.08}
          ifOverflow="extendDomain"
        />
      )}
      {signColors && <ReferenceLine y={0} stroke="var(--border)" />}
      <Tooltip
        cursor={
          type === 'bar' ? { fill: 'var(--muted)', opacity: 0.6 } : { stroke: 'var(--border)' }
        }
        content={({ active, payload, label }) => (
          <MoneyTooltip
            active={active}
            payload={payload}
            label={label}
            currency={currency}
            series={series}
          />
        )}
      />
    </>
  );
  return (
    <div className="h-52" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        {type === 'line' ? (
          <LineChart {...common}>
            {axes}
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
                type="monotone"
              />
            ))}
          </LineChart>
        ) : type === 'area' ? (
          <AreaChart {...common}>
            {axes}
            {series.map((s) => (
              <Area
                key={s.key}
                dataKey={s.key}
                stroke={s.color}
                fill={s.color}
                fillOpacity={stacked ? 0.5 : 0.12}
                strokeWidth={2}
                type="monotone"
                stackId={stacked ? 'stack' : undefined}
              />
            ))}
          </AreaChart>
        ) : (
          <BarChart {...common} barGap={2} barCategoryGap="22%">
            {axes}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                fill={s.color}
                radius={stacked ? 0 : [4, 4, 0, 0]}
                maxBarSize={stacked ? 28 : 22}
                stackId={stacked ? 'stack' : undefined}
              >
                {signColors &&
                  rows.map((r) => (
                    <Cell
                      key={String(r.month)}
                      fill={Number(r[s.key]) < 0 ? signColors[1] : signColors[0]}
                    />
                  ))}
              </Bar>
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
