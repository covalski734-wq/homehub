import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { users, workspaces } from './schema';

/**
 * Household members (migration 0019): who owns an income, an expense, an account, a fund part.
 * A NULL owner anywhere means «совместный». A member may be linked to a login (`user_id`), but
 * does not have to be: a child or a relative can own money without signing in. Members are
 * archived, never deleted, so old records keep their owner.
 */
export const members = sqliteTable(
  'members',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('members_workspace_idx').on(t.workspaceId),
    uniqueIndex('members_workspace_user_unique').on(t.workspaceId, t.userId),
    check('members_name', sql`length(${t.name}) BETWEEN 1 AND 40`),
    check(
      'members_color',
      sql.raw(`"color" GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'`),
    ),
  ],
);
