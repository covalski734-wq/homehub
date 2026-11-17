import type { BalanceDto, CurrencyTotalsDto } from '@homehub/shared';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';

interface KpiStripProps {
  currency: string;
  totals: CurrencyTotalsDto | undefined;
  balance: BalanceDto | undefined;
}

function Kpi({
  label,
  value,
  swatch,
  tone,
}: {
  label: string;
  value: string;
  swatch?: string;
  tone?: 'positive' | 'negative';
}) {
  return (
    <div className="bg-card px-4 py-3 sm:px-5 sm:py-4">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {swatch && (
          <span className="size-2 rounded-full" style={{ backgroundColor: swatch }} aria-hidden />
        )}
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 truncate text-lg font-semibold tracking-tight tabular sm:text-xl',
          tone === 'positive' && 'text-income',
          tone === 'negative' && 'text-expense',
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function KpiStrip({ currency, totals, balance }: KpiStripProps) {
  const net = Number(totals?.net ?? 0);
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border lg:grid-cols-4">
      <Kpi
        label={t('common.incomes')}
        value={formatMoney(totals?.income ?? 0, currency)}
        swatch="var(--chart-income)"
      />
      <Kpi
        label={t('common.expenses')}
        value={formatMoney(totals?.expense ?? 0, currency)}
        swatch="var(--chart-expense)"
      />
      <Kpi
        label={t('dashboard.kpi.monthNet')}
        value={formatMoney(totals?.net ?? 0, currency, { signed: true })}
        tone={net > 0 ? 'positive' : net < 0 ? 'negative' : undefined}
      />
      <Kpi label={t('dashboard.kpi.balance')} value={formatMoney(balance?.total ?? 0, currency)} />
    </dl>
  );
}
