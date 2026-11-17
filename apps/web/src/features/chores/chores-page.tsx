import type { ChoreDto } from '@homehub/shared';
import { Plus, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/features/auth/use-me';
import {
  localToday,
  useChores,
  useCompleteChore,
  useCreateChore,
  useDeleteChore,
  useSnoozeChore,
  useUndoCompletion,
} from './api';
import { ChoreFormDialog } from './chore-form-dialog';
import { ChoreHistory } from './chore-history';
import { ChoreRow } from './chore-row';
import { ChoreStarter } from './chore-starter';
import { HomeHealth, Heatmap, Leaderboard } from './chore-stats';
import { activity, choreViews, leaderboard } from './model';
import { t } from '@/i18n';

type View = 'today' | 'week' | 'all' | 'history';

export default function ChoresPage() {
  const chores = useChores();
  const me = useMe();
  const complete = useCompleteChore();
  const undo = useUndoCompletion();
  const snooze = useSnoozeChore();
  const remove = useDeleteChore();
  const restore = useCreateChore();
  const [view, setView] = useState<View>('today');
  const [onlyMine, setOnlyMine] = useState(false);
  const [editing, setEditing] = useState<ChoreDto | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const today = localToday();
  const meId = me.data?.user.id;

  const data = chores.data;
  const board = useMemo(
    () => (data ? leaderboard(data.completions, data.members, today) : []),
    [data, today],
  );
  const heat = useMemo(() => (data ? activity(data.completions, today) : []), [data, today]);

  const header = (
    <PageHeader
      title={t('chores.title')}
      description={t('chores.description')}
      actions={
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus /> {t('chores.addChore')}
        </Button>
      }
    />
  );

  if (chores.isPending)
    return (
      <>
        {header}
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
        <Skeleton className="mt-4 h-72 rounded-xl" />
      </>
    );
  if (chores.isError || !data)
    return (
      <>
        {header}
        <ErrorState error={chores.error} onRetry={() => void chores.refetch()} />
      </>
    );

  const views = choreViews(
    data.chores,
    today,
    (c) => !onlyMine || c.assigneeId === null || c.assigneeId === meId,
  );
  const shown = view === 'today' ? views.today : view === 'week' ? views.week : views.all;
  const doneToday = data.completions.filter((c) => c.doneOn === today).length;

  const completeChore = (chore: ChoreDto) =>
    complete.mutate(chore, {
      onSuccess: ({ completion }) =>
        toast.success(
          t(completion.onTime ? 'chores.toast.completed' : 'chores.toast.completedLate', {
            title: chore.title,
            points: completion.points,
          }),
          { action: { label: t('chores.toast.undo'), onClick: () => undo.mutate(completion.id) } },
        ),
    });

  const deleteChore = (chore: ChoreDto) =>
    remove.mutate(chore.id, {
      onSuccess: () =>
        toast.success(t('chores.toast.deleted', { title: chore.title }), {
          action: {
            label: t('chores.toast.restore'),
            onClick: () =>
              restore.mutate({
                title: chore.title,
                area: chore.area,
                assigneeId: chore.assigneeId,
                rotate: chore.rotate,
                intervalDays: chore.intervalDays,
                dueOn: chore.dueOn ?? today,
                effort: chore.effort,
                note: chore.note,
              }),
          },
        }),
    });

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        {data.chores.length > 0 && (
          <div className="order-2 grid gap-4 lg:order-1 lg:grid-cols-3">
            <HomeHealth chores={data.chores} today={today} />
            <Leaderboard board={board} meId={meId} />
            <Heatmap days={heat} today={today} />
          </div>
        )}

        <Card className="order-1 overflow-hidden lg:order-2" aria-labelledby="chores-list">
          <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5">
            <h2 id="chores-list" className="sr-only">
              {t('chores.list.title')}
            </h2>
            <SegmentedControl
              label={t('chores.views.label')}
              value={view}
              onChange={setView}
              options={[
                { value: 'today', label: t('chores.views.today') },
                { value: 'week', label: t('chores.views.week') },
                { value: 'all', label: t('common.all') },
                { value: 'history', label: t('chores.views.history') },
              ]}
              className="w-full sm:w-auto"
            />
            {data.members.length > 1 && view !== 'history' && (
              <Button
                variant={onlyMine ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={onlyMine}
                onClick={() => setOnlyMine((v) => !v)}
              >
                {t('chores.list.onlyMine')}
              </Button>
            )}
            {doneToday > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {t('chores.list.doneToday', { number: doneToday })}
              </span>
            )}
          </div>

          {data.chores.length === 0 ? (
            <>
              <EmptyState
                icon={<Sparkles />}
                title={t('chores.empty.title')}
                description={t('chores.empty.description')}
              />
              <ChoreStarter today={today} />
            </>
          ) : view === 'history' ? (
            <ChoreHistory data={data} />
          ) : shown.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-3xl" aria-hidden>
                {view === 'today' ? '🎉' : '🌿'}
              </p>
              <p className="mt-2 text-sm font-medium">
                {view === 'today' ? t('chores.list.allDoneToday') : t('chores.list.nothingPlanned')}
              </p>
              {view === 'today' && views.week.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('chores.list.laterThisWeek', { number: views.week.length })}
                </p>
              )}
            </div>
          ) : (
            <ul className="divide-y" aria-label={t('chores.list.label')}>
              {shown.map((chore) => (
                <ChoreRow
                  key={chore.id}
                  chore={chore}
                  today={today}
                  members={data.members}
                  busy={complete.isPending && complete.variables.id === chore.id}
                  onComplete={() => completeChore(chore)}
                  onSnooze={(days) =>
                    snooze.mutate(
                      { chore, days },
                      { onSuccess: () => toast.success(t('chores.toast.snoozed')) },
                    )
                  }
                  onEdit={() => {
                    setEditing(chore);
                    setFormOpen(true);
                  }}
                  onDelete={() => deleteChore(chore)}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ChoreFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        chore={editing}
        members={data.members}
      />
    </>
  );
}
