import type { PotDto } from '@homehub/shared';
import { Bitcoin, PiggyBank, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { MonthSwitcher } from '@/components/layout/month-switcher';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { ConfirmDialog } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMonth } from '@/hooks/use-month';
import { useSavings, useSavingsMutations } from './api';
import { AutoDialog } from './auto-dialog';
import { FundCard } from './fund-card';
import { InvestmentsSection, PricesStatus } from './investments-section';
import { MovementDialog } from './movement-dialog';
import { PartDialog } from './part-dialog';
import { PlanDialog } from './plan-dialog';
import { PortfolioCard } from './portfolio-card';
import { PositionDialog } from './position-dialog';
import { PotDialog } from './pot-dialog';
import { SavingsSummary } from './savings-summary';
import { useSavingsDialogs } from './use-savings-dialogs';
import { t } from '@/i18n';
import { WealthCard } from '../household/wealth-card';

/** Piggy banks: money pots with deposits, withdrawals and returns; portfolios of coins and tokens. */
export default function SavingsPage() {
  const { month } = useMonth();
  const savings = useSavings(month);
  const { deletePot, refreshPrices } = useSavingsMutations(month);
  const dialogs = useSavingsDialogs();
  const [showArchived, setShowArchived] = useState(false);

  const data = savings.data;
  const hasPortfolio = data?.pots.some((p) => p.kind === 'PORTFOLIO' && p.positions.length > 0);

  const header = (
    <PageHeader
      title={t('common.savings')}
      description={t('savings.page.description')}
      actions={
        <>
          <MonthSwitcher />
          <Button asChild variant="outline">
            <Link to="/accounts">{t('common.accounts')}</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() => dialogs.pot.create('PORTFOLIO')}
            disabled={!data}
          >
            <Bitcoin /> {t('savings.page.newPortfolio')}
          </Button>
          <Button onClick={() => dialogs.pot.create('CASH')} disabled={!data}>
            <Plus /> {t('savings.page.newCash')}
          </Button>
        </>
      }
    />
  );

  if (savings.isPending)
    return (
      <>
        {header}
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="mt-4 h-64 w-full rounded-xl" />
      </>
    );
  if (savings.isError || !data)
    return (
      <>
        {header}
        <ErrorState error={savings.error} onRetry={() => void savings.refetch()} />
      </>
    );

  const base = data.baseCurrency;
  const active = data.pots.filter((p) => !p.archived);
  const archived = data.pots.filter((p) => p.archived);
  const shown = showArchived ? data.pots : active;
  const cash = shown.filter((p) => p.kind === 'CASH');
  const portfolios = shown.filter((p) => p.kind === 'PORTFOLIO');
  const deleting = dialogs.deleting.state;
  const card = (pot: PotDto) =>
    pot.kind === 'CASH' ? (
      <FundCard
        key={pot.id}
        pot={pot}
        month={month}
        base={base}
        onMove={(type, subaccountId) => dialogs.movement.open({ pot, type, subaccountId })}
        onPart={(part) => dialogs.part.open({ pot, part })}
        onPlan={(part) => dialogs.plan.open({ pot, part })}
        onAuto={(part, rule) => dialogs.auto.open({ pot, part, rule })}
        onEdit={() => dialogs.pot.edit(pot)}
        onDelete={() => dialogs.deleting.open(pot)}
      />
    ) : (
      <PortfolioCard
        key={pot.id}
        pot={pot}
        month={month}
        base={base}
        onAdd={() => dialogs.position.open({ pot, position: null })}
        onEditPosition={(position) => dialogs.position.open({ pot, position })}
        onEdit={() => dialogs.pot.edit(pot)}
        onDelete={() => dialogs.deleting.open(pot)}
      />
    );

  const refresh = () =>
    refreshPrices.mutate(undefined, {
      onSuccess: () => toast.success(t('savings.prices.refreshed')),
    });

  return (
    <>
      {header}
      {active.length === 0 && archived.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PiggyBank />}
            title={t('savings.page.emptyTitle')}
            description={t('savings.page.emptyDescription')}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button onClick={() => dialogs.pot.create('CASH')}>
                  <PiggyBank /> {t('savings.page.addCash')}
                </Button>
                <Button variant="outline" onClick={() => dialogs.pot.create('PORTFOLIO')}>
                  <Bitcoin /> {t('savings.page.addPortfolio')}
                </Button>
              </div>
            }
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <SavingsSummary data={data} />
          <WealthCard month={month} search={`?month=${month}`} />
          {cash.length > 0 && (
            <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
              {cash.map(card)}
            </div>
          )}
          {portfolios.length > 0 && (
            <InvestmentsSection
              data={data}
              portfolios={portfolios}
              status={
                hasPortfolio && (
                  <PricesStatus
                    prices={data.prices}
                    pending={refreshPrices.isPending}
                    onRefresh={refresh}
                  />
                )
              }
            >
              {portfolios.map(card)}
            </InvestmentsSection>
          )}
          {archived.length > 0 && (
            <div className="flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
                {showArchived
                  ? t('savings.page.hideArchive')
                  : t('savings.page.showArchive', { count: archived.length })}
              </Button>
            </div>
          )}
        </div>
      )}

      <PotDialog state={dialogs.pot.state} month={month} onClose={dialogs.pot.close} />
      <MovementDialog
        state={dialogs.movement.state}
        month={month}
        onClose={dialogs.movement.close}
      />
      <PartDialog state={dialogs.part.state} month={month} onClose={dialogs.part.close} />
      <PlanDialog state={dialogs.plan.state} month={month} onClose={dialogs.plan.close} />
      <AutoDialog state={dialogs.auto.state} month={month} onClose={dialogs.auto.close} />
      <PositionDialog
        state={dialogs.position.state}
        month={month}
        onClose={dialogs.position.close}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && dialogs.deleting.close()}
        title={t('savings.page.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('savings.page.deleteDescription')}
        confirmLabel={t('common.delete')}
        destructive
        pending={deletePot.isPending}
        onConfirm={() =>
          deleting && deletePot.mutate(deleting.id, { onSuccess: dialogs.deleting.close })
        }
      />
    </>
  );
}
