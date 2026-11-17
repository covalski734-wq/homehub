import {
  JOINT_COLOR,
  type AutoRuleDto,
  type MovementDto,
  type MovementType,
  type PotDto,
  type SubaccountDto,
} from '@homehub/shared';
import { ArrowDownLeft, ArrowUpRight, ChevronDown, PiggyBank, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { formatFullDate, formatMoney, formatMonth } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useStoredFlag } from './hooks';
import { isPositive, partWidth, sameMoney } from './model';
import { HistoryDialog } from './history-dialog';
import { MovementEditDialog } from './movement-edit-dialog';
import { MovementRow } from './movement-row';
import { PartRow } from './part-row';
import { PotMenu } from './pot-menu';
import { useMembers } from '../household/api';
import { memberOf, OwnerBadge } from '../household/owner';
import { useAccounts } from '../accounts/use-accounts';
import { t } from '@/i18n';

/** A fund: balance and goal, the parts on their accounts, the month's plan and movements. */
export function FundCard({
  pot,
  month,
  base,
  onMove,
  onEdit,
  onDelete,
  onPart,
  onPlan,
  onAuto,
}: {
  pot: PotDto;
  month: string;
  base: string;
  onMove: (type: MovementType, subaccountId?: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onPart: (part: SubaccountDto | null) => void;
  onPlan: (part: SubaccountDto) => void;
  onAuto: (part: SubaccountDto, rule: AutoRuleDto | null) => void;
}) {
  const [open, setOpen] = useState(true);
  const members = useMembers();
  const accounts = useAccounts();
  const parts = pot.subaccounts.filter((s) => !s.archived);
  const colorOf = (s: SubaccountDto) =>
    s.color ?? memberOf(members.data, s.ownerId)?.color ?? JOINT_COLOR;
  const accountName = (id: string | null) =>
    id
      ? (accounts.data?.find((a) => a.id === id)?.name ?? t('savings.fund.someAccount'))
      : t('savings.fund.outsideAccounts');
  return (
    <Card
      className={cn('overflow-hidden', pot.archived && 'opacity-70')}
      role="region"
      aria-label={pot.name}
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-lg"
          style={{ backgroundColor: `${pot.color ?? '#10b981'}22` }}
          aria-hidden
        >
          {pot.icon ?? <PiggyBank className="size-5" style={{ color: pot.color ?? undefined }} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate font-semibold">
            {pot.name}
            {pot.archived && <Badge>{t('common.archive')}</Badge>}
          </h2>
          <p className="text-2xl font-semibold tracking-tight tabular">
            {formatMoney(pot.balance, pot.currency)}
            {!sameMoney(pot.forecast, pot.balance) && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                ({formatMoney(pot.forecast, pot.currency)})
              </span>
            )}
            {pot.target && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">
                / {formatMoney(pot.target, pot.currency)}
              </span>
            )}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <OwnerBadge ownerId={pot.ownerId} />
            {pot.value !== null && pot.currency !== base && (
              <span className="tabular">≈ {formatMoney(pot.value, base)}</span>
            )}
            {pot.progress !== null && <span className="tabular">{pot.progress}%</span>}
            {pot.forecastMonth && pot.target && (
              <span>
                {t('savings.fund.forecast', {
                  month: formatMonth(pot.forecastMonth).toLowerCase(),
                })}
              </span>
            )}
            {pot.targetDate && (
              <span>{t('savings.fund.targetDate', { date: formatFullDate(pot.targetDate) })}</span>
            )}
          </p>
        </div>
        <PotMenu pot={pot} month={month} onEdit={onEdit} onDelete={onDelete}>
          {!pot.archived && (
            <DropdownMenuItem onSelect={() => onPart(null)}>
              <Plus /> {t('savings.fund.addPart')}
            </DropdownMenuItem>
          )}
        </PotMenu>
      </div>
      {pot.description && (
        <p className="px-4 pt-1 text-xs text-muted-foreground">{pot.description}</p>
      )}

      {/* Shares of the parts; the target, when set, is the full width. */}
      {isPositive(pot.balance) && (
        <div
          className="mx-4 mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={parts
            .map((s) => `${s.name}: ${formatMoney(s.balance, pot.currency)}`)
            .join(', ')}
        >
          {parts.map((s) => (
            <span
              key={s.id}
              style={{
                width: `${partWidth(s.balance, pot.balance, pot.target)}%`,
                backgroundColor: colorOf(s),
              }}
            />
          ))}
        </div>
      )}

      {isPositive(pot.owed) && (
        <p className="mx-4 mt-3 rounded-lg bg-expense/10 px-3 py-2 text-sm">
          {t('savings.fund.owed', { amount: formatMoney(pot.owed, pot.currency) })}
        </p>
      )}

      <div className="mx-4 mt-3 grid grid-cols-3 gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
        <div>
          <p className="text-muted-foreground">{t('savings.fund.planned')}</p>
          <p className="font-medium tabular">{formatMoney(pot.planned, pot.currency)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('savings.fund.deposited')}</p>
          <p className="font-medium tabular text-income">
            {formatMoney(pot.deposited, pot.currency)}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">{t('savings.fund.forecastAmount')}</p>
          <p className="font-medium tabular">{formatMoney(pot.forecast, pot.currency)}</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-2 flex w-full items-center gap-1 px-4 py-1 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ChevronDown
          className={cn('size-3.5 transition-transform', !open && '-rotate-90')}
          aria-hidden
        />
        {t('savings.parts.toggle', { count: parts.length })}
      </button>
      {open && (
        <ul className="divide-y border-y" aria-label={t('savings.parts.list', { name: pot.name })}>
          {pot.subaccounts
            .filter((s) => !s.archived || pot.archived)
            .map((s) => (
              <PartRow
                key={s.id}
                pot={pot}
                month={month}
                part={s}
                color={colorOf(s)}
                accountName={accountName(s.accountId)}
                onMove={onMove}
                onPart={onPart}
                onPlan={onPlan}
                onAuto={onAuto}
              />
            ))}
        </ul>
      )}

      {open && !pot.archived && (
        <button
          type="button"
          onClick={() => onPart(null)}
          className="flex w-full items-center gap-1.5 border-b px-4 py-2 text-left text-xs font-medium text-primary outline-none hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <Plus className="size-3.5" aria-hidden /> {t('savings.parts.add')}
        </button>
      )}
      {!pot.archived && (
        <div className="grid grid-cols-2 gap-2 px-4 pt-3">
          <Button variant="outline" onClick={() => onMove('DEPOSIT')}>
            <ArrowDownLeft /> {t('savings.fund.deposit')}
          </Button>
          <Button variant="outline" onClick={() => onMove('WITHDRAWAL')}>
            <ArrowUpRight /> {t('savings.fund.withdraw')}
          </Button>
        </div>
      )}

      <FundMovements pot={pot} month={month} partCount={parts.length} />
      <div className="h-3" />
    </Card>
  );
}

/**
 * The movements of the shown month (and returns still due); everything is in «Вся история».
 * Rows name their part when the fund has several.
 */
function FundMovements({
  pot,
  month,
  partCount,
}: {
  pot: PotDto;
  month: string;
  partCount: number;
}) {
  const [listOpen, toggleList] = useStoredFlag(`homehub.savings.moves.${pot.id}`, true);
  const [editing, setEditing] = useState<MovementDto | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const shown = pot.movements;
  const partName = (id: string | null) => pot.subaccounts.find((s) => s.id === id)?.name;
  const row = (m: MovementDto) => (
    <MovementRow
      key={m.id}
      m={m}
      month={month}
      part={partCount > 1 ? partName(m.subaccountId) : undefined}
      onEdit={setEditing}
    />
  );
  return (
    <>
      <div className="mt-3 flex items-center justify-between border-t px-4 py-1.5">
        <button
          type="button"
          onClick={toggleList}
          aria-expanded={listOpen}
          className="flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <ChevronDown
            className={cn('size-3.5 transition-transform', !listOpen && '-rotate-90')}
            aria-hidden
          />
          {t('savings.fund.movementsToggle', {
            month: formatMonth(month).toLowerCase(),
            count: shown.length,
          })}
        </button>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="rounded-sm text-xs text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t('savings.fund.fullHistory')}
        </button>
      </div>
      {listOpen &&
        (shown.length > 0 ? (
          <ul
            className="divide-y border-t"
            aria-label={t('savings.history.title', { name: pot.name })}
          >
            {shown.map(row)}
          </ul>
        ) : (
          <p className="px-4 pb-1 text-xs text-muted-foreground">{t('savings.fund.noMovements')}</p>
        ))}
      <MovementEditDialog movement={editing} month={month} onClose={() => setEditing(null)} />
      <HistoryDialog
        pot={historyOpen ? pot : null}
        onClose={() => setHistoryOpen(false)}
        renderRow={row}
      />
    </>
  );
}
