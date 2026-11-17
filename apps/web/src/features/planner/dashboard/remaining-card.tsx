import {
  currentMonth,
  REMAINING_EXCLUDED_LIMIT,
  todayDate,
  type DashboardLayout,
  type MonthBudgetDto,
  type RemainingGroup,
} from '@homehub/shared';
import { ArrowRight, ChevronDown, Eye, EyeOff, TriangleAlert, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { errorMessage } from '@/lib/api';
import { formatMoney, formatMonth } from '@/lib/format';
import { fromCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { usePurchaseMutations, useRecurringMutations } from '../api';
import { REMAINING_GROUP_LABELS as GROUP_LABELS } from '../labels';
import {
  remainingItems,
  sumLeft,
  summarizeRemaining,
  type RemainingItem as Item,
} from './remaining';
import { widthPercent } from './chart-data';
import { RemainingItemRow, type RemainingFilter as Filter } from './remaining-item';
import { t } from '@/i18n';

type Remaining = NonNullable<DashboardLayout['remaining']>;

const OPEN_KEY = 'homehub.remaining.open';

function storedOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * How much of the month is still to be paid: regular payments not marked paid, planned purchases
 * not bought yet and the rest of ongoing payments (food, ads), which are prorated by days because
 * they cannot be ticked off at once. Collapsed it is a single summary; opened it lists the
 * payments. Payments can be ticked off right here; anything the user does not want to count can
 * be switched off — per payment or per group, stored with the user's dashboard layout.
 */
export function RemainingCard({
  budget,
  remaining,
  onRemainingChange,
  search,
}: {
  budget: MonthBudgetDto;
  remaining: Remaining | undefined;
  onRemainingChange: (next: Remaining) => void;
  search: string;
}) {
  const [open, setOpen] = useState(storedOpen);
  const [filter, setFilter] = useState<Filter>('left');
  const [busy, setBusy] = useState<string | null>(null);
  const recurringMutations = useRecurringMutations(budget.month);
  const purchaseMutations = usePurchaseMutations();
  const excluded = new Set(remaining?.excluded ?? []);
  const hiddenGroups = new Set(remaining?.hiddenGroups ?? []);
  const currency = budget.baseCurrency;
  const isCurrent = budget.month === currentMonth();
  const today = new Date().getDate();

  const items = remainingItems(budget);
  const isOff = (item: Item) => excluded.has(item.key) || hiddenGroups.has(item.group);
  const { counted, left, done, off, leftSum, doneSum, total, noRate } = summarizeRemaining(
    items,
    isOff,
  );
  const allPaid = leftSum <= 0n;
  const overdue = isCurrent ? left.filter((i) => i.dueDay !== null && i.dueDay < today) : [];

  if (items.length === 0) return null;

  const toggleOpen = () =>
    setOpen((value) => {
      try {
        localStorage.setItem(OPEN_KEY, value ? '0' : '1');
      } catch {
        // storage unavailable: the card just opens collapsed next time
      }
      return !value;
    });

  const save = (next: Partial<Remaining>) =>
    onRemainingChange({
      excluded: [...excluded],
      hiddenGroups: [...hiddenGroups],
      ...next,
    });

  const toggleItem = (item: Item) => {
    const next = new Set(excluded);
    if (next.has(item.key)) next.delete(item.key);
    else next.add(item.key);
    // Oldest switched-off entries (often deleted payments) make room for new ones.
    save({ excluded: [...next].slice(-REMAINING_EXCLUDED_LIMIT) });
  };

  const toggleGroup = (group: RemainingGroup) => {
    const next = new Set(hiddenGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    save({ hiddenGroups: [...next] });
  };

  const markDone = async (item: Item, value: boolean) => {
    setBusy(item.key);
    try {
      if (item.recurring)
        await recurringMutations.setPaid.mutateAsync({ id: item.recurring.id, paid: value });
      else if (item.purchase) {
        const p = item.purchase;
        if (value)
          await purchaseMutations.complete.mutateAsync({
            id: p.id,
            data: {
              purchasedOn: isCurrent ? todayDate() : null,
              actualAmount: p.estimatedAmount,
              version: p.version,
            },
          });
        else
          await purchaseMutations.setStatus.mutateAsync({
            id: p.id,
            action: 'unpurchase',
            version: p.version,
          });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  const shown = filter === 'left' ? left : filter === 'done' ? done : off;
  const paidShare = widthPercent(doneSum, total);

  return (
    <Card aria-labelledby="remaining-heading" className="overflow-hidden">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-controls="remaining-details"
        className="block w-full space-y-2.5 px-4 pt-3.5 pb-3 text-left outline-none hover:bg-muted/30 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span
              id="remaining-heading"
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
            >
              <Wallet className="size-3.5" aria-hidden />
              {t('planner.dashboard.remaining.title', {
                month: formatMonth(budget.month).toLowerCase(),
              })}
            </span>
            <span
              className={cn(
                'mt-0.5 block text-2xl font-semibold tracking-tight tabular sm:text-3xl',
                allPaid && 'text-income',
              )}
            >
              {formatMoney(fromCents(leftSum), currency)}
            </span>
            <span className="block text-xs text-muted-foreground tabular">
              {allPaid
                ? t('planner.dashboard.remaining.allPaid')
                : t('planner.dashboard.remaining.paidOf', {
                    paid: formatMoney(fromCents(doneSum), currency),
                    total: formatMoney(fromCents(total), currency),
                  })}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground">
            {open
              ? t('common.collapse')
              : t('planner.dashboard.remaining.list', { number: left.length })}
            <ChevronDown
              className={cn('size-4 transition-transform', open && 'rotate-180')}
              aria-hidden
            />
          </span>
        </span>

        <span
          className="block h-2 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label={t('planner.dashboard.remaining.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(paidShare)}
        >
          <span
            className="block h-full rounded-full bg-income"
            style={{ width: `${paidShare}%` }}
          />
        </span>

        {overdue.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
            {t('planner.dashboard.remaining.overdue', {
              names: overdue.map((i) => i.name).join(', '),
            })}
          </span>
        )}
      </button>

      {open && (
        <div id="remaining-details">
          <div className="space-y-3 border-t px-4 pt-3 pb-3">
            <div
              className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap"
              role="group"
              aria-label={t('planner.dashboard.remaining.groupsLabel')}
            >
              {(['required', 'other', 'purchases'] as const).map((group) => {
                const on = !hiddenGroups.has(group);
                const groupLeft = sumLeft(
                  items.filter((i) => i.group === group && !excluded.has(i.key)),
                );
                if (!items.some((i) => i.group === group)) return null;
                return (
                  <button
                    key={group}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleGroup(group)}
                    className={cn(
                      'grid min-w-0 grid-cols-[auto_1fr] items-center gap-x-1.5 rounded-lg border px-2 py-1.5 text-left text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:inline-flex sm:h-8 sm:rounded-full sm:px-3 sm:py-0',
                      on
                        ? 'border-primary/30 bg-primary/10 text-foreground'
                        : 'text-muted-foreground line-through decoration-1',
                    )}
                  >
                    {on ? (
                      <Eye className="size-3.5" aria-hidden />
                    ) : (
                      <EyeOff className="size-3.5" aria-hidden />
                    )}
                    <span className="truncate">{GROUP_LABELS[group]}</span>
                    <span className="col-span-2 truncate tabular opacity-70">
                      {formatMoney(fromCents(groupLeft), currency)}
                    </span>
                  </button>
                );
              })}
            </div>

            <SegmentedControl
              label={t('planner.dashboard.remaining.filter.label')}
              value={filter}
              onChange={setFilter}
              options={[
                {
                  value: 'left',
                  label: t('planner.dashboard.remaining.filter.left', { number: left.length }),
                },
                {
                  value: 'done',
                  label: t('planner.dashboard.remaining.filter.done', { number: done.length }),
                },
                {
                  value: 'off',
                  label: t('planner.dashboard.remaining.filter.off', { number: off.length }),
                },
              ]}
            />
          </div>

          {shown.length === 0 ? (
            <p className="border-t px-4 py-3 text-sm text-muted-foreground">
              {filter === 'left'
                ? t('planner.dashboard.remaining.empty.left')
                : filter === 'done'
                  ? t('planner.dashboard.remaining.empty.done')
                  : t('planner.dashboard.remaining.empty.off')}
            </p>
          ) : (
            <ul
              className="divide-y border-t text-sm"
              aria-label={t('planner.dashboard.remaining.listLabel')}
            >
              {shown.map((item) => (
                <RemainingItemRow
                  key={item.key}
                  item={item}
                  filter={filter}
                  currency={currency}
                  late={isCurrent && !item.done && item.dueDay !== null && item.dueDay < today}
                  off={isOff(item)}
                  excluded={excluded.has(item.key)}
                  groupHidden={hiddenGroups.has(item.group)}
                  busy={busy === item.key}
                  onDone={(value) => void markDone(item, value)}
                  onToggle={() => toggleItem(item)}
                />
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
            <span>
              {counted.some((i) => i.spent !== undefined) &&
                t('planner.dashboard.remaining.ongoingNote')}
            </span>
            <Link
              to={{ pathname: '/recurring', search }}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {t('planner.dashboard.remaining.link')} <ArrowRight className="size-3" aria-hidden />
            </Link>
          </div>
        </div>
      )}

      {noRate && (
        <p className="border-t px-4 py-2 text-xs text-destructive">
          {t('planner.dashboard.remaining.noRateNote')}
        </p>
      )}
    </Card>
  );
}
