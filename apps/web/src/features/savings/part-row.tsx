import type { AutoRuleDto, MovementType, PotDto, SubaccountDto } from '@homehub/shared';
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  Check,
  MoreHorizontal,
  History,
  Trash2,
  Pencil,
  Repeat,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatMoney } from '@/lib/format';
import { MODE_LABELS } from './labels';
import { isPositive, moneySign, sameMoney } from './model';
import { t } from '@/i18n';
import { useState } from 'react';
import { useSavingsMutations } from './api';
import { HistoryDialog } from './history-dialog';
import type { MovementDto } from '@homehub/shared';
import { MovementEditDialog } from './movement-edit-dialog';
import { MovementRow } from './movement-row';
import { toCents, fromCents } from '@/lib/money';

/** A part of a fund: owner colour, account, plan progress, balance and automatic operations. */
export function PartRow({
  pot,
  month,
  part: s,
  color,
  accountName,
  onMove,
  onPart,
  onPlan,
  onAuto,
}: {
  pot: PotDto;
  month: string;
  part: SubaccountDto;
  color: string;
  accountName: string;
  onMove: (type: MovementType, subaccountId?: string) => void;
  onPart: (part: SubaccountDto | null) => void;
  onPlan: (part: SubaccountDto) => void;
  onAuto: (part: SubaccountDto, rule: AutoRuleDto | null) => void;
}) {
  const mutations = useSavingsMutations(month);
  const [history, setHistory] = useState(false);
  const [editing, setEditing] = useState<MovementDto | null>(null);
  const pendingAutos = s.autoRules.some(
    (r) => r.type === 'DEPOSIT' && !r.done && isPositive(r.amount),
  );
  const left = toCents(s.planned) - toCents(s.deposited);
  const planned = isPositive(s.planned);
  return (
    <li className="py-2 pr-1 pl-4">
      <div className="flex items-center gap-2">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <button
          type="button"
          onClick={() => onPart(s)}
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="block truncate text-sm font-medium">{s.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {accountName}
            {planned &&
              ` · ${t('savings.parts.progress', {
                planned: formatMoney(s.planned, s.currency),
                deposited: formatMoney(s.deposited, s.currency),
              })}`}
            {s.rule && moneySign(s.planned) === 0 && ` · ${MODE_LABELS[s.rule.mode].toLowerCase()}`}
            {s.note && ` · ${s.note}`}
          </span>
        </button>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-medium tabular">
            {formatMoney(s.balance, s.currency)}
            {!sameMoney(s.forecast, s.balance) && (
              <span className="ml-1 font-normal text-muted-foreground">
                ({formatMoney(s.forecast, s.currency)})
              </span>
            )}
          </span>
          {s.currency !== pot.currency && s.valueInFund !== null && (
            <span className="block text-[11px] text-muted-foreground tabular">
              ≈ {formatMoney(s.valueInFund, pot.currency)}
            </span>
          )}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.actionsFor', { name: s.name })}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!pot.archived && (
              <>
                <DropdownMenuItem onSelect={() => onMove('DEPOSIT', s.id)}>
                  <ArrowDownLeft /> {t('savings.fund.deposit')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMove('WITHDRAWAL', s.id)}>
                  <ArrowUpRight /> {t('savings.fund.withdraw')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onPlan(s)}>
                  <CalendarClock /> {t('savings.parts.plan')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onAuto(s, null)}>
                  <Repeat /> {t('savings.parts.auto')}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onSelect={() => setHistory(true)}>
              <History /> {t('savings.parts.history')}
            </DropdownMenuItem>
            {!pot.archived && !s.archived && (
              <DropdownMenuItem
                disabled={mutations.deletePart.isPending}
                onSelect={() => mutations.deletePart.mutate(s.id)}
              >
                <Trash2 /> {t('savings.parts.remove')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => onPart(s)}>
              <Pencil /> {t('savings.parts.edit')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {!pot.archived && !s.archived && !pendingAutos && left > 0n && (
        <label className="ml-5 mt-2 flex items-center gap-2 text-sm text-primary">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={false}
            disabled={mutations.confirmPlan.isPending}
            onChange={() => mutations.confirmPlan.mutate(s.id)}
          />
          {t('savings.parts.confirm', { amount: formatMoney(fromCents(left), s.currency) })}
        </label>
      )}
      <MovementEditDialog movement={editing} month={month} onClose={() => setEditing(null)} />
      <HistoryDialog
        pot={history ? pot : null}
        partId={s.id}
        onClose={() => setHistory(false)}
        renderRow={(m) => <MovementRow key={m.id} m={m} month={month} onEdit={setEditing} />}
      />
      {s.autoRules.length > 0 && (
        <ul className="mt-1 ml-5 space-y-0.5">
          {s.autoRules.map((r) => (
            <li key={r.id} className="flex items-center gap-2">
              {r.type === 'DEPOSIT' && (
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label={t('savings.parts.confirm', {
                    amount: formatMoney(r.amount, s.currency),
                  })}
                  checked={r.done}
                  disabled={
                    r.done ||
                    mutations.confirmAuto.isPending ||
                    !isPositive(r.amount) ||
                    pot.archived ||
                    s.archived
                  }
                  onChange={() => mutations.confirmAuto.mutate(r.id)}
                />
              )}
              <button
                type="button"
                onClick={() => onAuto(s, r)}
                className="inline-flex items-center gap-1 rounded-sm text-xs text-primary outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <Repeat className="size-3" aria-hidden />
                {t(
                  r.type === 'WITHDRAWAL'
                    ? 'savings.parts.autoWithdrawal'
                    : 'savings.parts.autoDeposit',
                  { amount: formatMoney(r.amount, s.currency), day: r.day },
                )}
                {r.overridden && ` · ${t('savings.parts.autoOverridden')}`}
                {r.done && (
                  <Check className="size-3 text-income" aria-label={t('savings.parts.autoDone')} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
