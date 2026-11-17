import {
  addDaysToDate,
  CHORE_AREAS,
  dayDiff,
  type ChoreArea,
  type ChoreCompletionDto,
  type ChoreDto,
  type ChoreMemberDto,
} from '@homehub/shared';

export type Bucket = 'overdue' | 'today' | 'soon' | 'later' | 'done';

/** Where a chore belongs relative to today: «soon» is within a week. */
export function bucketOf(chore: Pick<ChoreDto, 'dueOn'>, today: string): Bucket {
  if (chore.dueOn === null) return 'done';
  const days = dayDiff(today, chore.dueOn);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return days <= 7 ? 'soon' : 'later';
}

/**
 * Freshness of one chore, 0…1: 1 while not overdue, then fading over one more interval
 * (a weekly chore a week late is at zero). One-off chores fade over a week.
 */
export function freshness(chore: Pick<ChoreDto, 'dueOn' | 'intervalDays'>, today: string) {
  if (chore.dueOn === null) return 1;
  const late = dayDiff(chore.dueOn, today);
  if (late <= 0) return 1;
  return Math.max(0, 1 - late / (chore.intervalDays ?? 7));
}

export interface AreaHealth {
  area: ChoreArea;
  /** 0…100. */
  score: number;
  overdue: number;
  total: number;
}

/** How «in order» each area of the home is: the average freshness of its open chores. */
export function areaHealth(chores: ChoreDto[], today: string): AreaHealth[] {
  return CHORE_AREAS.map((area) => {
    const open = chores.filter((c) => c.area === area && c.dueOn !== null);
    const score =
      open.length === 0
        ? 100
        : Math.round((open.reduce((s, c) => s + freshness(c, today), 0) / open.length) * 100);
    return {
      area,
      score,
      overdue: open.filter((c) => bucketOf(c, today) === 'overdue').length,
      total: open.length,
    };
  }).filter((a) => a.total > 0);
}

export function homeScore(chores: ChoreDto[], today: string): number | null {
  const open = chores.filter((c) => c.dueOn !== null);
  if (open.length === 0) return null;
  return Math.round((open.reduce((s, c) => s + freshness(c, today), 0) / open.length) * 100);
}

/** Consecutive days with at least one completion, ending today (or yesterday: today is not over). */
export function streak(dates: Iterable<string>, today: string): number {
  const days = new Set(dates);
  let day = days.has(today) ? today : addDaysToDate(today, -1);
  let count = 0;
  while (days.has(day)) {
    count += 1;
    day = addDaysToDate(day, -1);
  }
  return count;
}

export interface MemberScore {
  member: ChoreMemberDto;
  monthPoints: number;
  monthCount: number;
  weekPoints: number;
  onTimeShare: number | null;
  streak: number;
}

/** Points of the current month per member, best first; ties go to the longer streak. */
export function leaderboard(
  completions: ChoreCompletionDto[],
  members: ChoreMemberDto[],
  today: string,
): MemberScore[] {
  const month = today.slice(0, 7);
  const weekStart = addDaysToDate(today, -6);
  return members
    .map((member) => {
      const own = completions.filter((c) => c.userId === member.id);
      const inMonth = own.filter((c) => c.doneOn.startsWith(month));
      return {
        member,
        monthPoints: inMonth.reduce((s, c) => s + c.points, 0),
        monthCount: inMonth.length,
        weekPoints: own.filter((c) => c.doneOn >= weekStart).reduce((s, c) => s + c.points, 0),
        onTimeShare:
          inMonth.length === 0 ? null : inMonth.filter((c) => c.onTime).length / inMonth.length,
        streak: streak(
          own.map((c) => c.doneOn),
          today,
        ),
      };
    })
    .sort((a, b) => b.monthPoints - a.monthPoints || b.streak - a.streak);
}

export interface HeatDay {
  date: string;
  count: number;
}

/** Completions per day for the last `weeks` whole weeks (Monday first), oldest first. */
export function activity(completions: ChoreCompletionDto[], today: string, weeks = 12): HeatDay[] {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDaysToDate(today, -(weeks - 1) * 7 - weekday);
  const counts = new Map<string, number>();
  for (const c of completions) counts.set(c.doneOn, (counts.get(c.doneOn) ?? 0) + 1);
  const days: HeatDay[] = [];
  for (let day = start; day <= today; day = addDaysToDate(day, 1))
    days.push({ date: day, count: counts.get(day) ?? 0 });
  return days;
}

export const memberName = (member: ChoreMemberDto | undefined) =>
  member ? (member.name?.split(' ')[0] ?? member.email.split('@')[0] ?? member.email) : '';

export interface ChoreViews {
  /** Overdue and due today. */
  today: ChoreDto[];
  /** Due within a week (overdue included). */
  week: ChoreDto[];
  /** Every open chore, then the finished one-offs. */
  all: ChoreDto[];
}

/** The list views of the page; `shown` hides chores assigned to someone else («only mine»). */
export function choreViews(
  chores: ChoreDto[],
  today: string,
  shown: (chore: ChoreDto) => boolean,
): ChoreViews {
  const open = chores.filter((c) => c.dueOn !== null && shown(c));
  return {
    today: open.filter((c) => ['overdue', 'today'].includes(bucketOf(c, today))),
    week: open.filter((c) => bucketOf(c, today) !== 'later'),
    all: [...open, ...chores.filter((c) => c.dueOn === null && shown(c))],
  };
}

/** Colour of a 0…100 score: green from 80, amber from 50, red below. */
export const scoreTone = (score: number) =>
  score >= 80 ? 'var(--income)' : score >= 50 ? '#d97706' : 'var(--destructive)';

/** Heatmap shade 0…4 of a day relative to the busiest day. */
export const heatLevel = (count: number, max: number) =>
  count === 0 ? 0 : Math.ceil((count / max) * 4);

/** First due date of the n-th starter chore: spread so day one is not a wall of chores. */
export const starterDueOn = (today: string, index: number, intervalDays: number) =>
  addDaysToDate(today, index % Math.min(intervalDays, 4));
