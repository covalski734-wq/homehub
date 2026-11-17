import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useCreateChores } from './api';
import { AREA_ICONS, intervalLabel, STARTER_CHORES } from './labels';
import { starterDueOn } from './model';
import { t } from '@/i18n';

/** Ready-made chores for an empty list: pick, then add them in one go. */
export function ChoreStarter({ today }: { today: string }) {
  const [picked, setPicked] = useState(() => new Set(STARTER_CHORES.map((c) => c.title)));
  const create = useCreateChores();
  const add = () => {
    const chosen = STARTER_CHORES.filter((c) => picked.has(c.title));
    create.mutate(
      chosen.map((c, index) => ({
        title: c.title,
        area: c.area,
        intervalDays: c.intervalDays,
        effort: c.effort,
        dueOn: starterDueOn(today, index, c.intervalDays),
      })),
      { onSuccess: () => toast.success(t('chores.starter.added', { number: chosen.length })) },
    );
  };
  return (
    <div className="space-y-3 px-4 pb-4">
      <p className="text-sm text-muted-foreground">{t('chores.starter.hint')}</p>
      <div className="flex flex-wrap gap-1.5">
        {STARTER_CHORES.map((c) => {
          const on = picked.has(c.title);
          const Icon = AREA_ICONS[c.area];
          return (
            <button
              key={c.title}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (next.has(c.title)) next.delete(c.title);
                  else next.add(c.title);
                  return next;
                })
              }
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                on ? 'border-primary/40 bg-primary/10' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-3.5" aria-hidden />
              {c.title}
              <span className="text-muted-foreground">
                · {intervalLabel(c.intervalDays).toLowerCase()}
              </span>
            </button>
          );
        })}
      </div>
      <Button disabled={picked.size === 0 || create.isPending} onClick={add}>
        {create.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus />}
        {t('chores.starter.addSelected', { number: picked.size })}
      </Button>
    </div>
  );
}
