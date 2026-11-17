import {
  CHORE_AREAS,
  choreCreateSchema,
  type ChoreCreateInput,
  type ChoreDto,
} from '@homehub/shared';
import { z } from 'zod';
import { INTERVAL_PRESETS } from './labels';

export const EFFORT_VALUES = ['1', '2', '3'] as const;

/**
 * The chore form as the controls hold it, checked by the shared create schema. `interval` is ''
 * for a one-off, 'custom' when the number of days is typed into `intervalDays`, otherwise a preset
 * number of days. The typed days keep the schema's field name, so its errors land on that input.
 * Rotation only means something with more than one member.
 */
export const choreFormSchema = (members: number) =>
  z
    .object({
      title: z.string(),
      area: z.enum(CHORE_AREAS),
      interval: z.string(),
      intervalDays: z.string(),
      dueOn: z.string(),
      assigneeId: z.string(),
      rotate: z.boolean(),
      effort: z.enum(EFFORT_VALUES),
      note: z.string(),
    })
    .transform((v): ChoreCreateInput => ({
      title: v.title,
      area: v.area,
      intervalDays:
        v.interval === '' ? null : Number(v.interval === 'custom' ? v.intervalDays : v.interval),
      dueOn: v.dueOn,
      assigneeId: v.assigneeId || null,
      rotate: v.rotate && members > 1,
      effort: Number(v.effort),
      note: v.note,
    }))
    .pipe(choreCreateSchema);

export type ChoreFormValues = z.input<ReturnType<typeof choreFormSchema>>;
export type ChoreFormPayload = z.output<ReturnType<typeof choreFormSchema>>;

export function choreFormValues(chore: ChoreDto | null, today: string): ChoreFormValues {
  const days = chore ? chore.intervalDays : 7;
  const preset = INTERVAL_PRESETS.some((p) => p.value === days);
  return {
    title: chore?.title ?? '',
    area: chore?.area ?? 'KITCHEN',
    interval: days === null ? '' : preset ? String(days) : 'custom',
    intervalDays: days !== null && !preset ? String(days) : '',
    dueOn: chore?.dueOn ?? today,
    assigneeId: chore?.assigneeId ?? '',
    rotate: chore?.rotate ?? false,
    effort: EFFORT_VALUES.find((value) => value === String(chore?.effort ?? 1)) ?? '1',
    note: chore?.note ?? '',
  };
}
