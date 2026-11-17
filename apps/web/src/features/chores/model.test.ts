import type { ChoreCompletionDto, ChoreDto, ChoreMemberDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import {
  activity,
  areaHealth,
  bucketOf,
  choreViews,
  freshness,
  heatLevel,
  leaderboard,
  scoreTone,
  starterDueOn,
  streak,
} from './model';

const chore = (patch: Partial<ChoreDto>): ChoreDto => ({
  id: crypto.randomUUID(),
  title: 'x',
  area: 'KITCHEN',
  assigneeId: null,
  rotate: false,
  intervalDays: 7,
  dueOn: '2026-10-12',
  effort: 1,
  note: '',
  version: 1,
  lastDoneOn: null,
  lastDoneBy: null,
  doneCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

const done = (userId: string, doneOn: string, points = 2, onTime = true): ChoreCompletionDto => ({
  id: crypto.randomUUID(),
  choreId: 'c',
  userId,
  doneOn,
  points,
  onTime,
  createdAt: `${doneOn}T10:00:00.000Z`,
});

const members: ChoreMemberDto[] = [
  { id: 'a', name: 'Участник А Ковалевский', email: 'i@x', avatarUrl: null },
  { id: 'm', name: 'Участник Б', email: 'm@x', avatarUrl: null },
];

describe('chores model', () => {
  it('buckets chores by due date', () => {
    const today = '2026-10-12';
    expect(bucketOf({ dueOn: '2026-10-10' }, today)).toBe('overdue');
    expect(bucketOf({ dueOn: today }, today)).toBe('today');
    expect(bucketOf({ dueOn: '2026-10-19' }, today)).toBe('soon');
    expect(bucketOf({ dueOn: '2026-10-20' }, today)).toBe('later');
    expect(bucketOf({ dueOn: null }, today)).toBe('done');
  });

  it('fades freshness over one interval after the due date', () => {
    expect(freshness({ dueOn: '2026-10-12', intervalDays: 10 }, '2026-10-12')).toBe(1);
    expect(freshness({ dueOn: '2026-10-12', intervalDays: 10 }, '2026-10-17')).toBe(0.5);
    expect(freshness({ dueOn: '2026-10-01', intervalDays: 2 }, '2026-10-12')).toBe(0);
    const health = areaHealth(
      [chore({}), chore({ dueOn: '2026-10-05', intervalDays: 14 }), chore({ area: 'PETS' })],
      '2026-10-12',
    );
    expect(health).toEqual([
      { area: 'KITCHEN', score: 75, overdue: 1, total: 2 },
      { area: 'PETS', score: 100, overdue: 0, total: 1 },
    ]);
  });

  it('counts streaks that may end yesterday', () => {
    expect(streak(['2026-10-12', '2026-10-11', '2026-10-09'], '2026-10-12')).toBe(2);
    expect(streak(['2026-10-11', '2026-10-10'], '2026-10-12')).toBe(2);
    expect(streak(['2026-10-09'], '2026-10-12')).toBe(0);
  });

  it('ranks members by points of the month', () => {
    const board = leaderboard(
      [
        done('m', '2026-10-12', 3),
        done('m', '2026-10-11', 2, false),
        done('a', '2026-10-12', 4),
        done('a', '2026-09-30', 4),
      ],
      members,
      '2026-10-12',
    );
    expect(board.map((s) => [s.member.id, s.monthPoints, s.streak, s.onTimeShare])).toEqual([
      ['m', 5, 2, 0.5],
      ['a', 4, 1, 1],
    ]);
  });

  it('builds whole weeks of activity starting on Monday', () => {
    const days = activity([done('a', '2026-10-12'), done('m', '2026-10-12')], '2026-10-12', 2);
    // 2026-10-12 is a Monday: the previous whole week plus today.
    expect(days[0]).toEqual({ date: '2026-10-05', count: 0 });
    expect(days.at(-1)).toEqual({ date: '2026-10-12', count: 2 });
    expect(days).toHaveLength(8);
  });
});

describe('choreViews', () => {
  const today = '2026-10-12';
  const overdue = chore({ id: 'overdue', dueOn: '2026-10-10' });
  const dueToday = chore({ id: 'today', dueOn: today });
  const soon = chore({ id: 'soon', dueOn: '2026-10-19' });
  const later = chore({ id: 'later', dueOn: '2026-10-20' });
  const finished = chore({ id: 'finished', dueOn: null, intervalDays: null });
  const others = chore({ id: 'others', dueOn: today, assigneeId: 'u2' });
  const all = [finished, overdue, dueToday, soon, later, others];
  const ids = (list: ChoreDto[]) => list.map((c) => c.id);

  it('splits open chores by due date and puts finished one-offs last', () => {
    const views = choreViews(all, today, () => true);
    expect(ids(views.today)).toEqual(['overdue', 'today', 'others']);
    expect(ids(views.week)).toEqual(['overdue', 'today', 'soon', 'others']);
    expect(ids(views.all)).toEqual(['overdue', 'today', 'soon', 'later', 'others', 'finished']);
  });

  it('leaves out what the filter hides', () => {
    const views = choreViews(all, today, (c) => c.assigneeId === null);
    expect(ids(views.today)).toEqual(['overdue', 'today']);
  });
});

describe('scoreTone, heatLevel, starterDueOn', () => {
  it('colours a score by its band', () => {
    expect(scoreTone(80)).toBe('var(--income)');
    expect(scoreTone(79)).toBe('#d97706');
    expect(scoreTone(50)).toBe('#d97706');
    expect(scoreTone(49)).toBe('var(--destructive)');
  });

  it('shades a day in four steps of the busiest one', () => {
    expect([0, 1, 2, 3, 4, 5].map((c) => heatLevel(c, 5))).toEqual([0, 1, 2, 3, 4, 4]);
  });

  it('spreads starter chores over the first days, never past their interval', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => starterDueOn('2026-10-12', i, 7))).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-12',
      '2026-10-13',
    ]);
    expect(starterDueOn('2026-10-12', 3, 1)).toBe('2026-10-12');
  });
});
