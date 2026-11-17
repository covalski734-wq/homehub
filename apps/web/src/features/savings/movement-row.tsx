import { currentMonth, shiftMonth, type MovementDto } from '@homehub/shared';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  MoreHorizontal,
  Pencil,
  Trash2,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatFullDate, formatMoney, formatMonth } from '@/lib/format';
import { movementNote } from '@/lib/system-texts';
import { cn } from '@/lib/utils';
import { useSavingsMutations } from './api';
import { t } from '@/i18n';

/** A deposit or withdrawal of a fund, with its return to the fund when it is borrowed. */
export function MovementRow({
  m,
  month,
  part,
  onEdit,
}: {
  m: MovementDto;
  month: string;
  part?: string;
  onEdit: (m: MovementDto) => void;
}) {
  const { deleteMovement, setReturned, moveReturn } = useSavingsMutations(month);
  const r = m.repayment;
  const withdrawal = m.type === 'WITHDRAWAL';
  // An overdue return moves to the current month, a pending one a month later.
  const nextMonth =
    r && r.month < currentMonth() ? currentMonth() : shiftMonth(r?.month ?? month, 1);
  return (
    <li className="flex items-center gap-2 py-2 pr-1 pl-3">
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full',
          withdrawal ? 'bg-expense/10 text-expense' : 'bg-income/10 text-income',
        )}
        aria-hidden
      >
        {withdrawal ? (
          <ArrowUpRight className="size-3.5" />
        ) : (
          <ArrowDownLeft className="size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">
          {withdrawal ? t('savings.movements.withdrawn') : t('savings.movements.deposited')}
          {part && <span className="text-muted-foreground"> · {part}</span>}
          {m.transactionId && (
            <span className="text-muted-foreground"> · {t('savings.movements.transfer')}</span>
          )}
          {movementNote(m) && <span className="text-muted-foreground"> · {movementNote(m)}</span>}
        </p>
        <p
          className={cn('truncate text-xs text-muted-foreground', r?.overdue && 'text-destructive')}
        >
          {formatFullDate(m.date)}
          {r &&
            (r.returned
              ? ` · ${t('savings.movements.returnedIn', { month: formatMonth(r.month).toLowerCase() })}`
              : r.expenseId === null
                ? ` · ${t('savings.movements.repayDeleted')}`
                : r.overdue
                  ? ` · ${t('savings.movements.notReturnedIn', { month: formatMonth(r.month).toLowerCase() })}`
                  : ` · ${t('savings.movements.returnIn', { month: formatMonth(r.month).toLowerCase() })}`)}
        </p>
      </div>
      <span
        className={cn(
          'shrink-0 text-sm font-medium tabular',
          withdrawal && !r?.returned
            ? 'text-expense'
            : withdrawal
              ? 'text-muted-foreground line-through'
              : 'text-income',
        )}
      >
        {withdrawal ? '−' : '+'}
        {formatMoney(m.amount, m.currency)}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('savings.movements.actions')}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {r && r.expenseId !== null && (
            <DropdownMenuItem
              onSelect={() => setReturned.mutate({ id: m.id, returned: !r.returned })}
            >
              {r.returned ? <Undo2 /> : <Check />}
              {r.returned
                ? t('savings.movements.markNotReturned')
                : t('savings.movements.markReturned')}
            </DropdownMenuItem>
          )}
          {r && r.expenseId !== null && !r.returned && (
            <DropdownMenuItem
              onSelect={() => moveReturn.mutate({ id: m.id, repayMonth: nextMonth })}
            >
              <ArrowUpRight />
              {t('savings.movements.postpone', { month: formatMonth(nextMonth).toLowerCase() })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => onEdit(m)}>
            <Pencil /> {t('savings.movements.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onSelect={() => deleteMovement.mutate(m.id)}
          >
            <Trash2 />{' '}
            {withdrawal && r ? t('savings.movements.cancelWithdrawal') : t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
