import { fieldIssues, type ChoreDto } from '@homehub/shared';
import { describe, expect, it } from 'vitest';
import { choreFormSchema, choreFormValues } from './chore-form';

const chore = (patch: Partial<ChoreDto>): ChoreDto => ({
  id: 'c1',
  title: 'Dishes',
  area: 'KITCHEN',
  assigneeId: null,
  rotate: true,
  intervalDays: 7,
  dueOn: '2026-10-12',
  effort: 2,
  note: '',
  version: 3,
  lastDoneOn: null,
  lastDoneBy: null,
  doneCount: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

describe('choreFormValues', () => {
  it('starts a new chore weekly, due today', () => {
    expect(choreFormValues(null, '2026-10-12')).toMatchObject({
      interval: '7',
      intervalDays: '',
      dueOn: '2026-10-12',
      effort: '1',
    });
  });

  it('puts a non-preset interval into the typed days', () => {
    expect(choreFormValues(chore({ intervalDays: 10 }), '2026-10-12')).toMatchObject({
      interval: 'custom',
      intervalDays: '10',
      effort: '2',
    });
    expect(choreFormValues(chore({ intervalDays: null }), '2026-10-12').interval).toBe('');
  });
});

describe('choreFormSchema', () => {
  const values = choreFormValues(chore({}), '2026-10-12');

  it('turns the controls into the create payload', () => {
    expect(choreFormSchema(2).parse({ ...values, assigneeId: '' })).toEqual({
      title: 'Dishes',
      area: 'KITCHEN',
      intervalDays: 7,
      dueOn: '2026-10-12',
      assigneeId: null,
      rotate: true,
      effort: 2,
      note: '',
    });
  });

  it('reads typed days, a one-off, and drops rotation for a single member', () => {
    const custom = choreFormSchema(1).parse({ ...values, interval: 'custom', intervalDays: '10' });
    expect(custom).toMatchObject({ intervalDays: 10, rotate: false });
    expect(choreFormSchema(2).parse({ ...values, interval: '' }).intervalDays).toBeNull();
  });

  it('reports bad typed days on that field', () => {
    const result = choreFormSchema(2).safeParse({
      ...values,
      interval: 'custom',
      intervalDays: '',
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(fieldIssues(result.error)).toMatchObject([
        { path: 'intervalDays', code: 'VALIDATION_REPEAT_MIN' },
      ]);
  });
});
