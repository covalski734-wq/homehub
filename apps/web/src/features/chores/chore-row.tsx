import { dayDiff, type ChoreDto, type ChoreMemberDto } from '@homehub/shared';
import {
  CalendarClock,
  Check,
  Loader2,
  MoreHorizontal,
  Pencil,
  Repeat2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AREA_ICONS, AREA_LABELS, intervalLabel } from './labels';
import { bucketOf, memberName } from './model';
import { t } from '@/i18n';

function dueText(chore: ChoreDto, today: string) {
  if (chore.dueOn === null) return t('chores.due.done');
  const days = dayDiff(today, chore.dueOn);
  if (days < 0) return t('chores.due.overdue', { days: -days });
  if (days === 0) return t('chores.due.today');
  if (days === 1) return t('chores.due.tomorrow');
  if (days <= 7) return t('chores.due.inDays', { days });
  return formatDay(chore.dueOn);
}

export function ChoreRow({
  chore,
  today,
  members,
  busy,
  onComplete,
  onSnooze,
  onEdit,
  onDelete,
}: {
  chore: ChoreDto;
  today: string;
  members: ChoreMemberDto[];
  busy: boolean;
  onComplete: () => void;
  onSnooze: (days: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const bucket = bucketOf(chore, today);
  const Icon = AREA_ICONS[chore.area];
  const assignee = members.find((m) => m.id === chore.assigneeId);
  const done = chore.dueOn === null;
  return (
    <li className={cn('flex min-h-14 items-center gap-2 py-1.5 pr-1 pl-2', done && 'opacity-60')}>
      <button
        type="button"
        onClick={onComplete}
        disabled={busy || done}
        aria-label={t('chores.row.complete', { title: chore.title })}
        className={cn(
          'group flex size-11 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        )}
      >
        <span
          className={cn(
            'flex size-7 items-center justify-center rounded-full border-2 transition-colors',
            done
              ? 'border-income bg-income text-white'
              : bucket === 'overdue'
                ? 'border-destructive/60 group-hover:bg-destructive/10'
                : 'border-muted-foreground/40 group-hover:border-income group-hover:bg-income/10',
          )}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
          ) : (
            <Check
              className={cn(
                'size-4',
                done ? 'opacity-100' : 'text-income opacity-0 group-hover:opacity-100',
              )}
              aria-hidden
            />
          )}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', done && 'line-through')}>{chore.title}</p>
        <p className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <Icon className="size-3 shrink-0" aria-hidden />
          <span className="truncate">
            {[
              AREA_LABELS[chore.area],
              intervalLabel(chore.intervalDays).toLowerCase(),
              chore.rotate ? t('chores.row.rotate') : null,
              '●'.repeat(chore.effort),
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
            bucket === 'overdue' && 'bg-destructive/10 text-destructive',
            bucket === 'today' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
            (bucket === 'soon' || bucket === 'later') && 'bg-muted text-muted-foreground',
            bucket === 'done' && 'bg-income/10 text-income',
          )}
        >
          {dueText(chore, today)}
        </span>
        {assignee && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            {chore.rotate && <Repeat2 className="size-3" aria-hidden />}
            {memberName(assignee)}
          </span>
        )}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.actionsFor', { name: chore.title })}
          >
            <MoreHorizontal className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {!done && (
            <>
              <DropdownMenuItem onSelect={() => onSnooze(1)}>
                <CalendarClock /> {t('chores.row.snoozeDay')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSnooze(3)}>
                <CalendarClock /> {t('chores.row.snooze3Days')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onSnooze(7)}>
                <CalendarClock /> {t('chores.row.snoozeWeek')}
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil /> {done ? t('chores.row.editAndReturn') : t('common.edit')}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
