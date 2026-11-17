import { Eye, EyeOff, Hourglass } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { fromCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { t } from '@/i18n';
import { REMAINING_GROUP_LABELS as GROUP_LABELS } from '../labels';
import type { RemainingItem } from './remaining';

export type RemainingFilter = 'left' | 'done' | 'off';

/** One payment of the «left to pay» list: tick, name with its due day, amount, count switch. */
export function RemainingItemRow({
  item,
  filter,
  currency,
  late,
  off,
  excluded,
  groupHidden,
  busy,
  onDone,
  onToggle,
}: {
  item: RemainingItem;
  filter: RemainingFilter;
  /** Display currency. */
  currency: string;
  late: boolean;
  /** Not counted (by itself or with its group): shown dimmed. */
  off: boolean;
  excluded: boolean;
  groupHidden: boolean;
  busy: boolean;
  onDone: (done: boolean) => void;
  onToggle: () => void;
}) {
  const ongoing = item.spent !== undefined;
  return (
    <li className={cn('flex min-h-12 items-center gap-1 pr-2 pl-1.5', off && 'opacity-60')}>
      {ongoing ? (
        <span
          className="flex p-2.5 text-muted-foreground"
          title={t('planner.dashboard.remaining.ongoing')}
        >
          <Hourglass className="size-5" aria-hidden />
        </span>
      ) : (
        <label className="flex cursor-pointer items-center p-2.5 has-disabled:cursor-not-allowed">
          <input
            type="checkbox"
            className="size-5 accent-emerald-600"
            checked={item.done}
            disabled={busy}
            aria-label={
              item.purchase
                ? t('planner.dashboard.remaining.purchasedLabel', { name: item.name })
                : t('planner.dashboard.remaining.paidLabel', { name: item.name })
            }
            onChange={(e) => onDone(e.target.checked)}
          />
        </label>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn('truncate', item.done && !ongoing && 'text-muted-foreground line-through')}
        >
          {item.name}
        </p>
        <p className={cn('truncate text-xs text-muted-foreground', late && 'text-destructive')}>
          {[
            item.group === 'purchases'
              ? t('planner.dashboard.remaining.purchase')
              : GROUP_LABELS[item.group].toLowerCase(),
            item.window &&
              t('planner.dashboard.remaining.window', {
                first: item.window.first,
                last: item.window.last,
                passed: item.window.passed,
                days: item.window.days,
              }),
            item.dueDay !== null &&
              (late
                ? t('planner.dashboard.remaining.overdueBy', { day: item.dueDay })
                : t('planner.dashboard.remaining.dueBy', { day: item.dueDay })),
            groupHidden && t('planner.dashboard.remaining.groupOff'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <div className="shrink-0 text-right tabular">
        {ongoing && filter !== 'off' ? (
          <>
            <p className="font-medium">
              ≈{' '}
              {formatMoney(fromCents(filter === 'done' ? item.doneBase : item.leftBase), currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              {t('planner.dashboard.remaining.ofAmount', {
                amount: formatMoney(item.amount, item.currency),
              })}
            </p>
          </>
        ) : (
          <>
            <p className="font-medium">{formatMoney(item.amount, item.currency)}</p>
            {item.currency !== currency && (
              <p className="text-xs text-muted-foreground">
                {item.base === null
                  ? t('planner.dashboard.remaining.noRate')
                  : formatMoney(fromCents(item.base), currency)}
              </p>
            )}
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={!excluded}
        aria-label={
          excluded
            ? t('planner.dashboard.remaining.includeLabel', { name: item.name })
            : t('planner.dashboard.remaining.excludeLabel', { name: item.name })
        }
        title={
          excluded
            ? t('planner.dashboard.remaining.include')
            : t('planner.dashboard.remaining.exclude')
        }
        className="flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {excluded ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
      </button>
    </li>
  );
}
