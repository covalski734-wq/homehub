import type { ChoreDto } from '@homehub/shared';
import { Flame, Trophy } from 'lucide-react';
import { UserAvatar } from '@/components/layout/user-avatar';
import { Card } from '@/components/ui/card';
import { formatDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AREA_ICONS, AREA_LABELS } from './labels';
import {
  areaHealth,
  heatLevel,
  homeScore,
  memberName,
  scoreTone,
  type HeatDay,
  type MemberScore,
} from './model';
import { t } from '@/i18n';

/** Ring gauge of how «in order» the home is right now. */
function ScoreRing({ score }: { score: number }) {
  const r = 34;
  const length = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="size-24 shrink-0" role="img" aria-label={`${score}%`}>
      <circle cx="40" cy="40" r={r} fill="none" strokeWidth="8" className="stroke-muted" />
      <circle
        cx="40"
        cy="40"
        r={r}
        fill="none"
        strokeWidth="8"
        strokeLinecap="round"
        stroke={scoreTone(score)}
        strokeDasharray={`${(score / 100) * length} ${length}`}
        transform="rotate(-90 40 40)"
        className="transition-[stroke-dasharray] duration-700"
      />
      <text
        x="40"
        y="45"
        textAnchor="middle"
        className="fill-foreground text-[17px] font-semibold tabular"
      >
        {score}%
      </text>
    </svg>
  );
}

export function HomeHealth({ chores, today }: { chores: ChoreDto[]; today: string }) {
  const score = homeScore(chores, today);
  const areas = areaHealth(chores, today).sort((a, b) => a.score - b.score);
  return (
    <Card className="p-4" aria-labelledby="home-health">
      <h2 id="home-health" className="mb-3 text-sm font-semibold">
        {t('chores.health.title')}
      </h2>
      {score === null ? (
        <p className="text-sm text-muted-foreground">{t('chores.health.empty')}</p>
      ) : (
        <div className="flex items-center gap-4">
          <ScoreRing score={score} />
          <ul className="min-w-0 flex-1 space-y-1.5">
            {areas.slice(0, 5).map((a) => {
              const Icon = AREA_ICONS[a.area];
              return (
                <li
                  key={a.area}
                  className="grid grid-cols-[1rem_1fr_2.5rem] items-center gap-2 text-xs"
                >
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="min-w-0">
                    <span className="flex justify-between gap-2">
                      <span className="truncate">{AREA_LABELS[a.area]}</span>
                      {a.overdue > 0 && (
                        <span className="shrink-0 text-destructive">
                          {t('chores.health.overdue', { number: a.overdue })}
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full transition-[width] duration-700"
                        style={{ width: `${a.score}%`, backgroundColor: scoreTone(a.score) }}
                      />
                    </span>
                  </span>
                  <span className="text-right tabular">{a.score}%</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

export function Leaderboard({ board, meId }: { board: MemberScore[]; meId: string | undefined }) {
  const leader = board[0];
  return (
    <Card className="p-4" aria-labelledby="leaderboard">
      <h2 id="leaderboard" className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <Trophy className="size-4 text-amber-500" aria-hidden /> {t('chores.leaderboard.title')}
      </h2>
      <ol className="space-y-2.5">
        {board.map((s, index) => (
          <li key={s.member.id} className="flex items-center gap-3">
            <span className="w-4 text-center text-xs font-semibold text-muted-foreground tabular">
              {index + 1}
            </span>
            <span className="relative">
              <UserAvatar name={s.member.name} email={s.member.email} src={s.member.avatarUrl} />
              {index === 0 && s.monthPoints > 0 && (
                <span className="absolute -top-2 -right-1 text-sm" aria-hidden>
                  👑
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {memberName(s.member)}
                {s.member.id === meId && (
                  <span className="text-muted-foreground"> · {t('chores.leaderboard.you')}</span>
                )}
              </span>
              <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular">
                <span>{t('chores.leaderboard.choresDone', { number: s.monthCount })}</span>
                {s.onTimeShare !== null && (
                  <span>
                    {t('chores.leaderboard.onTime', { percent: Math.round(s.onTimeShare * 100) })}
                  </span>
                )}
                {s.streak > 1 && (
                  <span className="inline-flex items-center gap-0.5 text-orange-600">
                    <Flame className="size-3" aria-hidden />
                    {t('chores.leaderboard.streak', { days: s.streak })}
                  </span>
                )}
              </span>
            </span>
            <span className="text-right">
              <span className="block text-lg leading-none font-semibold tabular">
                {s.monthPoints}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {t('chores.leaderboard.points')}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {leader && board.length > 1 && leader.monthPoints > 0 && (
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
          {(board[1]?.monthPoints ?? 0) === leader.monthPoints
            ? t('chores.leaderboard.tie')
            : t('chores.leaderboard.ahead', {
                name: memberName(leader.member),
                points: leader.monthPoints - (board[1]?.monthPoints ?? 0),
              })}
        </p>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">{t('chores.leaderboard.rules')}</p>
    </Card>
  );
}

const heatColor = (level: number) =>
  level === 0
    ? 'var(--muted)'
    : `color-mix(in oklab, var(--income) ${25 + level * 18}%, transparent)`;

export function Heatmap({ days, today }: { days: HeatDay[]; today: string }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);
  const weeks: HeatDay[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));
  return (
    <Card className="p-4" aria-labelledby="heatmap">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="heatmap" className="text-sm font-semibold">
          {t('chores.heatmap.title')}
        </h2>
        <span className="text-xs text-muted-foreground tabular">
          {t('chores.heatmap.total', { number: total })}
        </span>
      </div>
      <div
        className="flex justify-center gap-[3px]"
        role="img"
        aria-label={t('chores.heatmap.label', { number: total })}
      >
        {weeks.map((week) => (
          <div key={week[0]?.date} className="grid grid-rows-7 gap-[3px]">
            {week.map((day) => (
              <span
                key={day.date}
                title={`${formatDay(day.date)}: ${day.count}`}
                className={cn(
                  'size-3 rounded-[3px] sm:size-3.5',
                  day.date === today && 'ring-1 ring-foreground/60',
                )}
                style={{ backgroundColor: heatColor(heatLevel(day.count, max)) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
        {t('chores.heatmap.less')}
        {[0, 1, 2, 3, 4].map((l) => (
          <span
            key={l}
            className="size-2.5 rounded-[2px]"
            style={{ backgroundColor: heatColor(l) }}
          />
        ))}
        {t('chores.heatmap.more')}
      </div>
    </Card>
  );
}
