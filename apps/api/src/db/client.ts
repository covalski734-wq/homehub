import { drizzle } from 'drizzle-orm/d1';
import { plannerSchema } from './planner-schema';
import { schema } from './schema';

export type Db = ReturnType<typeof createDb>;

export function createDb(d1: D1Database) {
  return drizzle(d1, { schema: { ...schema, ...plannerSchema } });
}
