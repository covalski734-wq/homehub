import {
  currentMonth,
  type MonthBudgetDto,
  type PlannerTrendPointDto,
  type PurchaseDto,
} from '@homehub/shared';
import {
  ArrowRight,
  CalendarDays,
  Check,
  Hourglass,
  PiggyBank,
  Repeat,
  ShoppingBag,
  Sparkles,
  Trophy,
  TrendingDown,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDay, formatMoney, formatMonth, formatShortMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { categoryLabel, RECURRING_CATEGORY_LABELS } from '../labels';
import { divRound, fromCents, sumCents, toCents } from '@/lib/money';
import { percentOf } from './chart-data';
import { spending, type PeriodSummary } from './period';
import { t } from '@/i18n';

const LIMIT = 6;

const linkClass =
  'inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50';

function Panel({
  icon: Icon,
  title,
  link,
  children,
  footer,
}: {
  icon: LucideIcon;
  title: string;
  link?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden" aria-label={title}>
      <CardHeader className="items-center px-4 py-2.5 sm:px-4 sm:pt-2.5">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" aria-hidden /> {title}
        </CardTitle>
        {link}
      </CardHeader>
      {children}
      {footer}
    </Card>
  );
}

/** "Show all (N)" under a list cut to the first rows. */
function MoreToggle({
  total,
  open,
  onToggle,
}: {
  total: number;
  open: boolean;
  onToggle: () => void;
}) {
  if (total <= LIMIT) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="w-full border-t px-4 py-2 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {open ? t('common.collapse') : t('planner.dashboard.panels.showAll', { total: total })}
    </button>
  );
}

/** Regular payments of the month by due day; in the current month the upcoming ones go first. */
export function PaymentsList({ budget, search }: { budget: MonthBudgetDto; search: string }) {
  const [open, setOpen] = useState(false);
  const today = budget.month === currentMonth() ? new Date().getDate() : 0;
  const payments = budget.recurring
    .filter((r) => r.active)
    .sort((a, b) => {
      const order = (p: typeof a) =>
        ((p.paid && !p.isOngoing) || (p.dueDay ?? 99) < today ? 100 : 0) + (p.dueDay ?? 99);
      return order(a) - order(b);
    });
  const shown = open ? payments : payments.slice(0, LIMIT);
  const tickable = payments.filter((p) => !p.isOngoing);
  const unpaid = tickable.filter((p) => !p.paid).length;
  return (
    <Panel
      icon={CalendarDays}
      title={t('planner.dashboard.payments.title')}
      link={
        <Link to={{ pathname: '/recurring', search }} className={linkClass}>
          {payments.length > 0 &&
            t('planner.dashboard.payments.unpaidOf', { unpaid: unpaid, total: tickable.length })}
          <ArrowRight className="size-3" aria-hidden />
          <span className="sr-only">{t('planner.dashboard.payments.all')}</span>
        </Link>
      }
      footer={
        <MoreToggle total={payments.length} open={open} onToggle={() => setOpen((v) => !v)} />
      }
    >
      {payments.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">
          {t('planner.dashboard.payments.empty')}
        </p>
      ) : (
        <ul className="divide-y border-t text-sm">
          {shown.map((p) => (
            <li
              key={p.id}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5',
                p.paid && !p.isOngoing && 'text-muted-foreground',
              )}
              title={RECURRING_CATEGORY_LABELS[p.category]}
            >
              <span className="w-6 shrink-0 text-center text-xs text-muted-foreground tabular">
                {p.isOngoing ? (
                  <Hourglass
                    className="mx-auto size-3.5"
                    aria-label={t('planner.dashboard.payments.ongoing')}
                  />
                ) : p.paid ? (
                  <Check
                    className="mx-auto size-3.5 text-income"
                    aria-label={t('planner.dashboard.payments.paid')}
                  />
                ) : (
                  (p.dueDay ?? '—')
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="shrink-0 text-right tabular">
                {formatMoney(p.amount, p.currency)}
                {p.currency !== budget.baseCurrency && p.base && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    {formatMoney(p.base, budget.baseCurrency)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function PurchasesList({
  purchases,
  title,
  search,
  empty,
  showMonth,
}: {
  purchases: PurchaseDto[];
  title: string;
  search: string;
  empty: string;
  showMonth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...purchases].sort((a, b) =>
    (b.budgetMonth ?? '').localeCompare(a.budgetMonth ?? ''),
  );
  const shown = open ? sorted : sorted.slice(0, LIMIT);
  return (
    <Panel
      icon={ShoppingBag}
      title={title}
      link={
        <Link to={{ pathname: '/purchases', search }} className={linkClass}>
          {t('planner.dashboard.purchases.wishlist')} <ArrowRight className="size-3" aria-hidden />
        </Link>
      }
      footer={<MoreToggle total={sorted.length} open={open} onToggle={() => setOpen((v) => !v)} />}
    >
      {sorted.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y border-t text-sm">
          {shown.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-4 py-1.5">
              <span className="min-w-0 flex-1 truncate">{p.title}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {p.status === 'PURCHASED'
                  ? p.purchasedOn
                    ? t('planner.dashboard.purchases.purchasedOn', {
                        date: formatDay(p.purchasedOn),
                      })
                    : t('planner.dashboard.purchases.purchased')
                  : showMonth && p.budgetMonth
                    ? formatShortMonth(p.budgetMonth)
                    : t('planner.dashboard.purchases.planned')}
              </span>
              <span className="w-24 shrink-0 text-right tabular">
                {formatMoney(p.budgetAmount, p.currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** Each month of the period in one row: a quick comparison without opening every month. */
export function MonthsTable({
  months,
  currency,
  onOpen,
}: {
  months: PlannerTrendPointDto[];
  currency: string;
  onOpen: (month: string) => void;
}) {
  const money = (v: string) => formatMoney(v, currency);
  return (
    <Panel icon={CalendarDays} title={t('planner.dashboard.months.title')}>
      <div className="overflow-x-auto border-t">
        <table className="w-full text-xs whitespace-nowrap sm:text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-1.5 [&>th]:font-medium">
              <th className="text-left">{t('common.month')}</th>
              <th className="text-right">{t('common.income')}</th>
              <th className="text-right">{t('common.expenses')}</th>
              <th className="text-right">{t('common.savings')}</th>
              <th className="text-right">{t('planner.dashboard.months.free')}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {[...months].reverse().map((m) => (
              <tr key={m.month} className="tabular [&>td]:px-3 [&>td]:py-1.5">
                <td>
                  <button
                    type="button"
                    className="rounded-sm text-left underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    onClick={() => onOpen(m.month)}
                  >
                    {formatShortMonth(m.month)} {m.month.slice(0, 4)}
                  </button>
                </td>
                <td className="text-right">{money(m.netIncome)}</td>
                <td className="text-right">{money(spending(m))}</td>
                <td className="text-right">{money(m.savingsTarget)}</td>
                <td
                  className={cn(
                    'text-right font-medium',
                    Number(m.free) < 0 ? 'text-destructive' : 'text-income',
                  )}
                >
                  {formatMoney(m.free, currency, { signed: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Fact({
  icon: Icon,
  label,
  value,
  note,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <li className="flex min-w-0 items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        <p
          className={cn(
            'truncate text-sm font-semibold tabular',
            tone === 'good' && 'text-income',
            tone === 'bad' && 'text-destructive',
          )}
        >
          {value}
        </p>
        {note && <p className="truncate text-[11px] text-muted-foreground">{note}</p>}
      </div>
    </li>
  );
}

/** Short facts computed from the period and the last twelve months. */
export function Insights({
  summary,
  window,
  currency,
  monthBudget,
}: {
  summary: PeriodSummary;
  window: PlannerTrendPointDto[];
  currency: string;
  monthBudget?: MonthBudgetDto;
}) {
  const { totals, months, breakdown } = summary;
  const count = Math.max(months.length, 1);
  const net = toCents(totals.netIncome);
  const rate = net > 0n ? percentOf(toCents(totals.savingsTarget), net) : null;
  const spent = toCents(spending(totals));
  const top = breakdown[0];
  const topShare = top ? percentOf(toCents(top.amount), spent) : 0;
  const best = window.reduce<PlannerTrendPointDto | undefined>(
    (b, p) => (!b || toCents(p.free) > toCents(b.free) ? p : b),
    undefined,
  );
  const year = summary.to.slice(0, 4);
  const ytd = fromCents(
    window
      .filter((p) => p.month.startsWith(year) && p.month <= summary.to)
      .reduce((s, p) => s + toCents(p.savingsTarget), 0n),
  );
  const subscriptions = monthBudget?.recurring.filter(
    (r) => r.active && r.category === 'SUBSCRIPTIONS',
  );
  const subscriptionsTotal = fromCents(sumCents((subscriptions ?? []).map((r) => r.base ?? '0')));
  const overMonths = months.filter((m) => Number(m.free) < 0).length;

  return (
    <section aria-labelledby="insights-heading">
      <h2 id="insights-heading" className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Sparkles className="size-4 text-muted-foreground" aria-hidden />{' '}
        {t('planner.dashboard.insights.title')}
      </h2>
      <ul className="grid grid-cols-2 gap-2 md:grid-cols-3">
        <Fact
          icon={PiggyBank}
          label={t('planner.dashboard.insights.savingsRate')}
          value={rate === null ? '—' : `${rate}%`}
          note={t('planner.dashboard.insights.savingsRateNote')}
          tone={rate !== null && rate >= 20 ? 'good' : undefined}
        />
        <Fact
          icon={Wallet}
          label={t('planner.dashboard.insights.averageSpending')}
          value={formatMoney(fromCents(divRound(spent, BigInt(count))), currency)}
          note={t('planner.dashboard.insights.averageSpendingNote')}
        />
        <Fact
          icon={TrendingDown}
          label={t('planner.dashboard.insights.topCategory')}
          value={top ? categoryLabel(top.key) : '—'}
          note={
            top
              ? t('planner.dashboard.insights.topCategoryNote', {
                  share: topShare,
                  amount: formatMoney(top.amount, currency),
                })
              : undefined
          }
        />
        {subscriptions ? (
          <Fact
            icon={Repeat}
            label={t('planner.dashboard.insights.subscriptions')}
            value={formatMoney(subscriptionsTotal, currency)}
            note={t('planner.dashboard.insights.subscriptionsNote', {
              quantity: subscriptions.length,
            })}
          />
        ) : (
          <Fact
            icon={Repeat}
            label={t('planner.dashboard.insights.overMonths')}
            value={t('planner.dashboard.insights.overMonthsValue', {
              over: overMonths,
              total: months.length,
            })}
            note={t('planner.dashboard.insights.overMonthsNote')}
            tone={overMonths > 0 ? 'bad' : 'good'}
          />
        )}
        <Fact
          icon={Trophy}
          label={t('planner.dashboard.insights.bestMonth')}
          value={best ? formatMonth(best.month) : '—'}
          note={
            best
              ? t('planner.dashboard.insights.bestMonthNote', {
                  amount: formatMoney(best.free, currency, { signed: true }),
                })
              : undefined
          }
        />
        <Fact
          icon={PiggyBank}
          label={t('planner.dashboard.insights.savedInYear', { year: year })}
          value={formatMoney(ytd, currency)}
          note={t('planner.dashboard.insights.savedInYearNote')}
        />
      </ul>
    </section>
  );
}
