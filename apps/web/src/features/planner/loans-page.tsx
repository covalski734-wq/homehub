import { shiftMonth, type LoanDto } from '@homehub/shared';
import { CalendarCheck, CreditCard, PartyPopper } from 'lucide-react';
import { Link } from 'react-router';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { formatMoney, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useLoans } from './api';
import { isClosed, loansSummary, repaidPercent } from './loans';
import { t } from '@/i18n';

function LoanCard({ loan, base }: { loan: LoanDto; base: string }) {
  const share = repaidPercent(loan);
  const closed = isClosed(loan);
  const left =
    loan.paymentsTotal === null ? null : Math.max(loan.paymentsTotal - loan.paymentsPaid, 0);
  return (
    <Card
      className={cn('space-y-3 p-4', closed && 'opacity-70')}
      aria-label={loan.name}
      role="region"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{loan.name}</h2>
          <p className="text-xs text-muted-foreground">
            {formatMonth(loan.startMonth)} —{' '}
            {loan.endMonth ? formatMonth(loan.endMonth) : t('planner.loans.card.noEnd')}
            {loan.intervalMonths > 1 &&
              ` · ${t('planner.loans.card.interval', { months: loan.intervalMonths })}`}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs text-muted-foreground">{t('planner.loans.card.remaining')}</p>
          <p
            className={cn(
              'text-lg font-semibold tabular',
              closed ? 'text-income' : 'text-foreground',
            )}
          >
            {loan.remaining === null ? '—' : formatMoney(loan.remaining, loan.currency)}
          </p>
          {loan.remainingBase !== null && loan.currency !== base && !closed && (
            <p className="text-xs text-muted-foreground tabular">
              ≈ {formatMoney(loan.remainingBase, base)}
            </p>
          )}
        </div>
      </div>

      {loan.total !== null && (
        <div>
          <div
            className="h-2.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label={t('planner.loans.card.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(share)}
          >
            <div
              className="h-full rounded-full bg-income transition-[width] duration-700"
              style={{ width: `${share}%` }}
            />
          </div>
          <p className="mt-1 flex justify-between text-xs text-muted-foreground tabular">
            <span>
              {t('planner.loans.card.paidOf', {
                paid: formatMoney(loan.paid, loan.currency),
                total: formatMoney(loan.total, loan.currency),
              })}
              {loan.totalIsManual && ` · ${t('planner.loans.card.manualTotal')}`}
            </span>
            <span>{Math.round(share)}%</span>
          </p>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">{t('planner.loans.card.payment')}</dt>
          <dd className="font-medium tabular">{formatMoney(loan.payment, loan.currency)}</dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">{t('planner.loans.card.payments')}</dt>
          <dd className="font-medium tabular">
            {loan.paymentsTotal === null
              ? loan.paymentsPaid
              : t('planner.loans.card.paymentsOf', {
                  paid: loan.paymentsPaid,
                  total: loan.paymentsTotal,
                })}
          </dd>
        </div>
        <div className="rounded-lg bg-muted/40 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">
            {t('planner.loans.card.paymentsLeft')}
          </dt>
          <dd className="font-medium tabular">{left ?? '∞'}</dd>
        </div>
      </dl>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {closed ? (
          <>
            <PartyPopper className="size-3.5 text-income" aria-hidden />
            {t('planner.loans.card.closed')}
          </>
        ) : loan.nextMonth ? (
          <>
            <CalendarCheck className="size-3.5" aria-hidden />
            {t('planner.loans.card.nextPayment', {
              month: formatMonth(loan.nextMonth).toLowerCase(),
            })}
          </>
        ) : null}
      </p>
    </Card>
  );
}

/** Loans and installment plans: how much is repaid, how much is left and until when. */
export default function LoansPage() {
  const { month } = useMonth();
  const loans = useLoans(month);
  const header = (
    <PageHeader
      title={t('planner.loans.title')}
      description={t('planner.loans.description')}
      actions={<MonthSwitcher />}
    />
  );
  if (loans.isPending)
    return (
      <>
        {header}
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="mt-4 h-48 w-full rounded-xl" />
      </>
    );
  if (loans.isError)
    return (
      <>
        {header}
        <ErrorState error={loans.error} onRetry={() => void loans.refetch()} />
      </>
    );

  const { baseCurrency: base, loans: list } = loans.data;
  const { open, closed, remaining, monthly } = loansSummary(list);
  const lastEnd = open
    .map((l) => l.endMonth)
    .filter((m): m is string => m !== null)
    .sort()
    .at(-1);

  if (list.length === 0)
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<CreditCard />}
            title={t('planner.loans.empty.title')}
            description={t('planner.loans.empty.description')}
            action={
              <Button asChild>
                <Link to={{ pathname: '/recurring', search: `?month=${month}` }}>
                  {t('planner.loans.empty.action')}
                </Link>
              </Button>
            }
          />
        </Card>
      </>
    );

  return (
    <>
      {header}
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
          <div className="bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">
              {t('planner.loans.summary.remaining')}
            </dt>
            <dd className="text-xl font-semibold tabular">{formatMoney(remaining, base)}</dd>
          </div>
          <div className="bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{t('planner.loans.summary.monthly')}</dt>
            <dd className="text-xl font-semibold tabular">{formatMoney(monthly, base)}</dd>
          </div>
          <div className="col-span-2 bg-card px-4 py-3 sm:col-span-1">
            <dt className="text-xs text-muted-foreground">{t('planner.loans.summary.freeFrom')}</dt>
            <dd className="text-xl font-semibold">
              {lastEnd ? formatMonth(shiftMonth(lastEnd, 1)) : '—'}
            </dd>
          </div>
        </dl>
        <div className="grid gap-4 md:grid-cols-2">
          {open.map((loan) => (
            <LoanCard key={loan.id} loan={loan} base={base} />
          ))}
        </div>
        {closed.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t('planner.loans.closedTitle')}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {closed.map((loan) => (
                <LoanCard key={loan.id} loan={loan} base={base} />
              ))}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
