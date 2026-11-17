import {
  choreCompleteSchema,
  choreCreateSchema,
  choreSnoozeSchema,
  choreUpdateSchema,
  dateSchema,
  idSchema,
  preferencesUpdateSchema,
  shoppingAddSchema,
  shoppingUpdateSchema,
  todayDate,
} from '@homehub/shared';
import { z } from 'zod';

import { defineTool } from '../tool';

const byId = z.object({ id: idSchema });
/** The member's local date, as in the routes: the server runs in UTC. */
const today = dateSchema.optional();
/** Chores, the shopping list, the member's reminders and interface preferences. */
export const householdTools = [
  defineTool({
    name: 'chores_get_overview',
    title: 'Домашние дела',
    description:
      'All household chores (with version, due date "YYYY-MM-DD", assignee, repeat interval), the members and completions of the last 120 days. `today` is the member\'s local date (defaults to today in UTC).',
    scope: 'household:read',
    input: z.object({ today }),
    run: ({ ctx, services }, input) =>
      services.chores.overview(ctx.workspaceId, input.today ?? todayDate()),
  }),
  defineTool({
    name: 'chores_create_chore',
    title: 'Добавить дело',
    description:
      'Adds a chore: one-off (intervalDays null) or repeating every N days from the day it was last done; the assignee must be a member.',
    scope: 'household:write',
    input: z.object({ data: choreCreateSchema }),
    run: ({ ctx, services }, { data }) => services.chores.create(ctx.workspaceId, ctx.userId, data),
  }),
  defineTool({
    name: 'chores_update_chore',
    title: 'Изменить дело',
    description:
      "Changes only the given fields of a chore; needs the chore's version from the overview (a stale version is refused).",
    scope: 'household:write',
    input: z.object({ id: idSchema, data: choreUpdateSchema }),
    run: ({ ctx, services }, { id, data }) => services.chores.update(ctx.workspaceId, id, data),
  }),
  defineTool({
    name: 'chores_delete_chore',
    title: 'Удалить дело',
    description: 'Deletes a chore together with its completion history.',
    scope: 'household:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.chores.remove(ctx.workspaceId, id),
  }),
  defineTool({
    name: 'chores_complete_chore',
    title: 'Отметить дело выполненным',
    description:
      'Records that the caller did a chore on `doneOn` ("YYYY-MM-DD", the local date) and awards points; a repeating chore moves to its next date, a rotating one to the next member. Needs the chore\'s version.',
    scope: 'household:write',
    input: z.object({ id: idSchema, data: choreCompleteSchema }),
    run: ({ ctx, services }, { id, data }) =>
      services.chores.complete(ctx.workspaceId, ctx.userId, id, data),
  }),
  defineTool({
    name: 'chores_snooze_chore',
    title: 'Отложить дело',
    description:
      "Moves a chore's due date by `days` (1–30), counted from today for an overdue chore. Needs the chore's version; `today` is the local date (defaults to today in UTC).",
    scope: 'household:write',
    input: z.object({ id: idSchema, data: choreSnoozeSchema, today }),
    run: ({ ctx, services }, input) =>
      services.chores.snooze(ctx.workspaceId, input.id, input.data, input.today ?? todayDate()),
  }),
  defineTool({
    name: 'chores_undo_completion',
    title: 'Отменить выполнение',
    description:
      "Undoes a completion (id from the overview's completions): its points are removed and, if it is the latest one, the chore gets back its previous date and assignee.",
    scope: 'household:write',
    input: byId,
    annotations: { destructive: true },
    run: ({ ctx, services }, { id }) => services.chores.undo(ctx.workspaceId, id),
  }),

  defineTool({
    name: 'shopping_list_items',
    title: 'Список покупок',
    description:
      'The shared shopping list (title, quantity, checked) and the most often bought things that are not on it now.',
    scope: 'household:read',
    input: z.object({}),
    run: ({ ctx, services }) => services.shopping.list(ctx.workspaceId),
  }),
  defineTool({
    name: 'shopping_add_items',
    title: 'Добавить покупки',
    description:
      'Adds up to 50 items (title, optional quantity text like "2 kg") and returns the list; an item already unchecked on the list is skipped, not duplicated.',
    scope: 'household:write',
    input: z.object({ data: shoppingAddSchema }),
    run: ({ ctx, services }, { data }) => services.shopping.add(ctx.workspaceId, ctx.userId, data),
  }),
  defineTool({
    name: 'shopping_update_item',
    title: 'Изменить покупку',
    description: 'Changes the given fields of an item: title, quantity, or ticks it off (checked).',
    scope: 'household:write',
    input: z.object({ id: idSchema, data: shoppingUpdateSchema }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { id, data }) => services.shopping.update(ctx.workspaceId, id, data),
  }),
  defineTool({
    name: 'shopping_delete_item',
    title: 'Удалить покупку',
    description: 'Removes an item from the list.',
    scope: 'household:write',
    input: byId,
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }, { id }) => services.shopping.remove(ctx.workspaceId, id),
  }),
  defineTool({
    name: 'shopping_clear_checked',
    title: 'Убрать купленное',
    description:
      'Removes every checked item from the list (they feed the "often bought" suggestions) and returns the list.',
    scope: 'household:write',
    input: z.object({}),
    annotations: { destructive: true, idempotent: true },
    run: ({ ctx, services }) => services.shopping.clearChecked(ctx.workspaceId),
  }),

  defineTool({
    name: 'preferences_get_preferences',
    title: 'Настройки интерфейса',
    description: "The caller's interface language (ru or uk), colour labels and demo mode flag.",
    scope: 'household:read',
    input: z.object({}),
    run: ({ ctx, services }) => services.preferences.get(ctx.userId),
  }),
  defineTool({
    name: 'preferences_update_preferences',
    title: 'Изменить настройки интерфейса',
    description:
      "Changes the given fields of the caller's preferences: language (ru or uk) and colour labels. Demo mode cannot be switched here.",
    scope: 'household:write',
    // Switching demo mode replaces the whole workspace the member sees: only the app does it.
    input: z.object({ data: preferencesUpdateSchema.omit({ demoMode: true }) }),
    annotations: { idempotent: true },
    run: ({ ctx, services }, { data }) => services.preferences.update(ctx.userId, data),
  }),
];
