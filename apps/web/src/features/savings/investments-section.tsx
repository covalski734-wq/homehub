import type { PotDto, SavingsOverviewDto } from '@homehub/shared';
import { ChevronDown, Eye, EyeOff, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatMoney, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useNow, useStoredFlag } from './hooks';
import { investmentsTotal } from './model';
import { t } from '@/i18n';

const INVEST_OPEN_KEY = 'homehub.savings.investOpen';
const INVEST_PRIVATE_KEY = 'homehub.savings.investPrivate';

/**
 * «Криптовалюты и акции»: the portfolios in one block that collapses to its title and total.
 * Collapsing only hides — totals above still include the portfolios. The total in the collapsed
 * title can be hidden for privacy; both choices are remembered in this browser.
 */
export function InvestmentsSection({
  data,
  portfolios,
  status,
  children,
}: {
  data: SavingsOverviewDto;
  portfolios: PotDto[];
  status: ReactNode;
  children: ReactNode;
}) {
  const [open, toggleOpen] = useStoredFlag(INVEST_OPEN_KEY, true);
  const [hidden, toggleHidden] = useStoredFlag(INVEST_PRIVATE_KEY, false);
  const base = data.baseCurrency;
  const { total, empty } = investmentsTotal(portfolios);
  return (
    <section aria-labelledby="investments-heading" className="space-y-3">
      <div className="flex items-center gap-2 rounded-xl border bg-card px-2 py-1.5">
        <button
          type="button"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls="investments-body"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronDown
            className={cn('size-4 shrink-0 transition-transform', !open && '-rotate-90')}
            aria-hidden
          />
          <h2 id="investments-heading" className="truncate font-semibold">
            {t('savings.crypto.title')}
          </h2>
          <span className="ml-auto shrink-0 text-sm font-medium tabular">
            {open || !hidden ? (empty ? '—' : formatMoney(total, base)) : '•••'}
          </span>
        </button>
        {!open && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleHidden}
            aria-pressed={hidden}
            aria-label={hidden ? t('savings.crypto.showTotal') : t('savings.crypto.hideTotal')}
            title={hidden ? t('savings.crypto.showTotal') : t('savings.crypto.hideTotal')}
          >
            {hidden ? <Eye /> : <EyeOff />}
          </Button>
        )}
      </div>
      {open && (
        <div id="investments-body" className="space-y-2">
          <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
          {status}
        </div>
      )}
    </section>
  );
}

/**
 * Where the coin prices come from and how fresh they are. When CoinGecko refuses (429) the stored
 * prices keep working and the time of the last good update is shown.
 */
export function PricesStatus({
  prices,
  pending,
  onRefresh,
}: {
  prices: SavingsOverviewDto['prices'];
  pending: boolean;
  onRefresh: () => void;
}) {
  const failing = prices.retryAt !== null || (prices.lastError !== null && prices.stale);
  // Computed by the server when the page loaded: compared with a clock that ticks every 15 s.
  const now = useNow(15_000);
  const waitUntil =
    prices.refreshAvailableAt && Date.parse(prices.refreshAvailableAt) > now
      ? prices.refreshAvailableAt
      : null;
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-1 px-1 text-xs',
        failing ? 'text-destructive' : 'text-muted-foreground',
      )}
      role={failing ? 'status' : undefined}
    >
      {failing
        ? prices.lastSuccessAt
          ? t('savings.prices.stale', {
              time: formatDateTime(prices.lastSuccessAt),
            })
          : t('savings.prices.limited')
        : prices.lastSuccessAt
          ? t('savings.prices.updated', {
              time: formatDateTime(prices.lastSuccessAt),
            })
          : t('savings.prices.daily')}
      {prices.retryAt && (
        <span>· {t('savings.prices.retryAt', { time: formatTime(prices.retryAt) })}</span>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onRefresh}
        disabled={pending || waitUntil !== null}
        aria-label={
          waitUntil
            ? t('savings.prices.refreshAt', { time: formatTime(waitUntil) })
            : t('savings.prices.refresh')
        }
        title={
          waitUntil ? t('savings.prices.refreshAt', { time: formatTime(waitUntil) }) : undefined
        }
      >
        <RefreshCw className={cn(pending && 'animate-spin')} />
      </Button>
    </p>
  );
}
