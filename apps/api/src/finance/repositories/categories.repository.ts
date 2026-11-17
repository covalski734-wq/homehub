import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { categories } from '../../db/schema';

export type CategoryRow = typeof categories.$inferSelect;

export class CategoriesRepository {
  constructor(private readonly db: Db) {}

  list(workspaceId: string): Promise<CategoryRow[]> {
    return this.db
      .select()
      .from(categories)
      .where(eq(categories.workspaceId, workspaceId))
      .orderBy(asc(categories.kind), desc(categories.isSystem), asc(categories.name));
  }

  async findById(workspaceId: string, id: string): Promise<CategoryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(categories)
      .where(and(eq(categories.id, id), eq(categories.workspaceId, workspaceId)))
      .limit(1);
    return row;
  }
}
