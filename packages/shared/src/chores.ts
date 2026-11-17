import { z } from 'zod';
import { isValidDate } from './month';

/**
 * Household chores: a shared list of things that keep the home running. A chore is either
 * one-off or repeats every N days counted from the day it was last done (so a late clean-up does
 * not leave the next one overdue at once). Completing a chore records who did it and awards
 * points: its effort (1–3) plus one for doing it on time. Rotating chores pass to the next member.
 */

export const CHORE_AREAS = [
  'KITCHEN',
  'BATHROOM',
  'ROOMS',
  'LAUNDRY',
  'SHOPPING',
  'PLANTS',
  'PETS',
  'REPAIRS',
  'PAPERWORK',
  'OTHER',
] as const;
export type ChoreArea = (typeof CHORE_AREAS)[number];

export const CHORE_EFFORTS = [1, 2, 3] as const;
export const CHORE_SNOOZE_MAX_DAYS = 30;
/** How far back the overview returns completions (history, leaderboard, streaks). */
export const CHORE_HISTORY_DAYS = 120;

const date = z.string().refine(isValidDate, 'VALIDATION_DATE_FORMAT');
const title = z.string().trim().min(1, 'VALIDATION_NAME_REQUIRED').max(120, 'VALIDATION_TOO_LONG');
const note = z.string().trim().max(500, 'VALIDATION_TOO_LONG');
const interval = z
  .number()
  .int()
  .min(1, 'VALIDATION_REPEAT_MIN')
  .max(365, 'VALIDATION_REPEAT_MAX')
  .nullable();
const effort = z.number().int().min(1).max(3);
const version = z.number().int().min(1);

export const choreCreateSchema = z.object({
  title,
  area: z.enum(CHORE_AREAS).default('OTHER'),
  assigneeId: z.string().uuid().nullable().default(null),
  rotate: z.boolean().default(false),
  intervalDays: interval.default(7),
  dueOn: date,
  effort: effort.default(1),
  note: note.default(''),
});
export type ChoreCreateInput = z.input<typeof choreCreateSchema>;

export const choreUpdateSchema = z
  .object({
    title,
    area: z.enum(CHORE_AREAS),
    assigneeId: z.string().uuid().nullable(),
    rotate: z.boolean(),
    intervalDays: interval,
    dueOn: date.nullable(),
    effort,
    note,
  })
  .partial()
  .extend({ version });
export type ChoreUpdateInput = z.input<typeof choreUpdateSchema>;

/** `doneOn` is the member's local date: the server does not know the household's time zone. */
export const choreCompleteSchema = z.object({ doneOn: date, version });
export type ChoreCompleteInput = z.input<typeof choreCompleteSchema>;

export const choreSnoozeSchema = z.object({
  days: z.number().int().min(1).max(CHORE_SNOOZE_MAX_DAYS),
  version,
});
export type ChoreSnoozeInput = z.input<typeof choreSnoozeSchema>;

export interface ChoreMemberDto {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

export interface ChoreDto {
  id: string;
  title: string;
  area: ChoreArea;
  assigneeId: string | null;
  rotate: boolean;
  /** null: one-off. */
  intervalDays: number | null;
  /** null: a one-off chore that is done. */
  dueOn: string | null;
  effort: number;
  note: string;
  version: number;
  lastDoneOn: string | null;
  lastDoneBy: string | null;
  doneCount: number;
  createdAt: string;
}

export interface ChoreCompletionDto {
  id: string;
  choreId: string;
  userId: string;
  doneOn: string;
  points: number;
  /** Done no later than it was due. */
  onTime: boolean;
  createdAt: string;
}

export interface ChoresOverviewDto {
  chores: ChoreDto[];
  members: ChoreMemberDto[];
  /** Completions of the last CHORE_HISTORY_DAYS days, newest first. */
  completions: ChoreCompletionDto[];
}

/** Adds days to an ISO date (UTC arithmetic: dates carry no time zone). */
export function addDaysToDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function dayDiff(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Points for a completion: effort, plus one when done on or before the due date. */
export function chorePoints(effortValue: number, dueOn: string | null, doneOn: string): number {
  return effortValue + (dueOn === null || doneOn <= dueOn ? 1 : 0);
}
