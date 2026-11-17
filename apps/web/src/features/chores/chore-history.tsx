import type { ChoresOverviewDto } from '@homehub/shared';
import { History, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { UserAvatar } from '@/components/layout/user-avatar';
import { Button } from '@/components/ui/button';
import { formatDay } from '@/lib/format';
import { useUndoCompletion } from './api';
import { memberName } from './model';
import { t } from '@/i18n';

/** Who did what lately; a completion can be taken back (its points go with it). */
export function ChoreHistory({ data }: { data: ChoresOverviewDto }) {
  const undo = useUndoCompletion();
  if (data.completions.length === 0)
    return (
      <p className="px-4 py-6 text-center text-sm text-muted-foreground">
        {t('chores.history.empty')}
      </p>
    );
  const choreById = new Map(data.chores.map((c) => [c.id, c]));
  const memberById = new Map(data.members.map((m) => [m.id, m]));
  return (
    <ul className="divide-y" aria-label={t('chores.views.history')}>
      {data.completions.slice(0, 60).map((c) => {
        const chore = choreById.get(c.choreId);
        const member = memberById.get(c.userId);
        return (
          <li key={c.id} className="flex items-center gap-3 px-3 py-2">
            {member ? (
              <UserAvatar
                name={member.name}
                email={member.email}
                src={member.avatarUrl}
                className="size-7"
              />
            ) : (
              <History className="size-5 text-muted-foreground" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                <span className="font-medium">{memberName(member)}</span>{' '}
                {chore?.title ?? t('chores.history.deletedChore')}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDay(c.doneOn)} ·{' '}
                {c.onTime ? t('chores.history.onTime') : t('chores.history.late')}
              </p>
            </div>
            <span className="text-sm font-semibold text-income tabular">+{c.points}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('chores.history.undo', { title: chore?.title ?? '' })}
              onClick={() =>
                undo.mutate(c.id, { onSuccess: () => toast.success(t('chores.history.undone')) })
              }
            >
              <Undo2 className="text-muted-foreground" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
