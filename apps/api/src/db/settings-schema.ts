import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { users } from './schema';

/** Per-user interface preferences (migration 0009): language and colour labels. */
export const userSettings = sqliteTable(
  'user_settings',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    language: text('language', { enum: ['ru', 'uk'] })
      .notNull()
      .default('ru'),
    colorLabels: integer('color_labels', { mode: 'boolean' }).notNull().default(true),
    demoMode: integer('demo_mode', { mode: 'boolean' }).notNull().default(false),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [
    check('user_settings_demo_mode', sql`${t.demoMode} IN (0, 1)`),
    check('user_settings_language', sql`${t.language} IN ('ru', 'uk')`),
    check('user_settings_color_labels', sql`${t.colorLabels} IN (0, 1)`),
  ],
);
