import type { SavingsOverviewDto } from '@homehub/shared';
import { formatMoney, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { isNegative, isPositive, subtractMoney } from './model';
import { t } from '@/i18n';

/** The month's savings plan against deposits, and what the funds hold in all. */
export function SavingsSummary({ data }: { data: SavingsOverviewDto }) {
  const base = data.baseCurrency;
  const net = subtractMoney(data.deposited, data.withdrawn);
  return (
    <div className="space-y-2">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">
            {t('savings.summary.target', { month: formatMonth(data.month).toLowerCase() })}
          </dt>
          <dd className="text-xl font-semibold tabular">{formatMoney(data.savingsTarget, base)}</dd>
          <dd className="text-[11px] text-muted-foreground">{t('savings.summary.targetHint')}</dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{t('savings.summary.distributed')}</dt>
          <dd className="text-xl font-semibold tabular">{formatMoney(data.distributed, base)}</dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{t('savings.summary.undistributed')}</dt>
          <dd
            className={cn(
              'text-xl font-semibold tabular',
              isPositive(data.unallocated) && 'text-amber-600 dark:text-amber-400',
            )}
          >
            {formatMoney(data.unallocated, base)}
          </dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">
            {t('savings.summary.depositedThisMonth')}
          </dt>
          <dd
            className={cn(
              'text-xl font-semibold tabular',
              isNegative(net) ? 'text-expense' : 'text-income',
            )}
          >
            {formatMoney(net, base, { signed: true })}
          </dd>
          <dd className="text-[11px] text-muted-foreground tabular">
            +{formatMoney(data.deposited, base)} / −{formatMoney(data.withdrawn, base)}
          </dd>
        </div>
      </dl>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
        <div className="col-span-2 bg-card px-4 py-3 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">{t('savings.summary.total')}</dt>
          <dd className="text-xl font-semibold tabular">{formatMoney(data.total, base)}</dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{t('savings.summary.depositedByPlan')}</dt>
          <dd className="text-xl font-semibold tabular">
            {formatMoney(data.deposited, base)}
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {t('savings.summary.ofPlanned', { amount: formatMoney(data.distributed, base) })}
            </span>
          </dd>
        </div>
        <div className="bg-card px-4 py-3">
          <dt className="text-xs text-muted-foreground">{t('savings.summary.owed')}</dt>
          <dd
            className={cn('text-xl font-semibold tabular', isPositive(data.owed) && 'text-expense')}
          >
            {formatMoney(data.owed, base)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
