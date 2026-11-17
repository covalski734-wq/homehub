import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from 'drizzle-orm/sqlite-core';
import { users, workspaces } from './schema';

/**
 * Household chores (migration 0012). A chore belongs to the shared workspace; a completion
 * records who did it, when and the points it earned. `prev_*` columns of a completion keep the
 * chore's state before it, so the latest completion can be undone exactly.
 */

const isDate = (column: string) =>
  sql.raw(
    `"${column}" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND date("${column}") = "${column}"`,
  );
const isOptionalDate = (column: string) =>
  sql.raw(
    `"${column}" IS NULL OR ("${column}" GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND date("${column}") = "${column}")`,
  );

export const chores = sqliteTable(
  'chores',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    area: text('area').notNull().default('OTHER'),
    assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    rotate: integer('rotate', { mode: 'boolean' }).notNull().default(false),
    /** null: one-off. */
    intervalDays: integer('interval_days'),
    /** null: a one-off chore that is done. */
    dueOn: text('due_on'),
    effort: integer('effort').notNull().default(1),
    note: text('note').notNull().default(''),
    version: integer('version').notNull().default(1),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    unique('chores_id_workspace_unique').on(t.id, t.workspaceId),
    index('chores_workspace_idx').on(t.workspaceId),
    check(
      'chores_area',
      sql.raw(`"area" IN ('KITCHEN', 'BATHROOM', 'ROOMS', 'LAUNDRY', 'SHOPPING', 'PLANTS', 'PETS',
        'REPAIRS', 'PAPERWORK', 'OTHER')`),
    ),
    check('chores_title', sql`length(${t.title}) BETWEEN 1 AND 120`),
    check('chores_rotate', sql`${t.rotate} IN (0, 1)`),
    check('chores_interval', sql`${t.intervalDays} IS NULL OR ${t.intervalDays} BETWEEN 1 AND 365`),
    check('chores_effort', sql`${t.effort} BETWEEN 1 AND 3`),
    check('chores_due_on', isOptionalDate('due_on')),
  ],
);

export const choreCompletions = sqliteTable(
  'chore_completions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text('workspace_id').notNull(),
    choreId: text('chore_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    doneOn: text('done_on').notNull(),
    points: integer('points').notNull(),
    onTime: integer('on_time', { mode: 'boolean' }).notNull(),
    prevDueOn: text('prev_due_on'),
    prevAssigneeId: text('prev_assignee_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.choreId, t.workspaceId],
      foreignColumns: [chores.id, chores.workspaceId],
    }).onDelete('cascade'),
    index('chore_completions_workspace_done_idx').on(t.workspaceId, t.doneOn),
    index('chore_completions_chore_idx').on(t.choreId),
    check('chore_completions_done_on', isDate('done_on')),
    check('chore_completions_points', sql`${t.points} BETWEEN 1 AND 4`),
    check('chore_completions_on_time', sql`${t.onTime} IN (0, 1)`),
  ],
);

/** Shared shopping list (migration 0016). */
export const shoppingItems = sqliteTable(
  'shopping_items',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    quantity: text('quantity').notNull().default(''),
    checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    index('shopping_items_workspace_idx').on(t.workspaceId),
    check('shopping_items_title', sql`length(${t.title}) BETWEEN 1 AND 80`),
    check('shopping_items_checked', sql`${t.checked} IN (0, 1)`),
  ],
);

/** How often each thing was bought: feeds one-tap suggestions. */
export const shoppingHistory = sqliteTable(
  'shopping_history',
  {
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    titleKey: text('title_key').notNull(),
    title: text('title').notNull(),
    count: integer('count').notNull().default(1),
    lastAt: integer('last_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.titleKey] })],
);
