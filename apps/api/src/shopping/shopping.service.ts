import {
  shoppingKey,
  type shoppingAddSchema,
  type ShoppingItemDto,
  type ShoppingListDto,
  type shoppingUpdateSchema,
} from '@homehub/shared';
import type { z } from 'zod';
import { notFound } from '../lib/http-error';

type Out<T extends z.ZodType> = z.output<T>;

interface ItemRow {
  id: string;
  title: string;
  quantity: string;
  checked: number;
  created_by: string | null;
  created_at: number;
  checked_at: number | null;
}

const toItem = (r: ItemRow): ShoppingItemDto => ({
  id: r.id,
  title: r.title,
  quantity: r.quantity,
  checked: Boolean(r.checked),
  createdBy: r.created_by,
  createdAt: new Date(r.created_at).toISOString(),
  checkedAt: r.checked_at === null ? null : new Date(r.checked_at).toISOString(),
});

/** Cap on unbought items: the list is for the next trip to the store, not an archive. */
const MAX_OPEN_ITEMS = 300;

export class ShoppingService {
  constructor(private readonly db: D1Database) {}

  async list(workspaceId: string): Promise<ShoppingListDto> {
    const [items, history] = await Promise.all([
      this.db
        .prepare(
          `SELECT id, title, quantity, checked, created_by, created_at, checked_at
           FROM shopping_items WHERE workspace_id = ? ORDER BY checked, created_at`,
        )
        .bind(workspaceId)
        .all<ItemRow>(),
      this.db
        .prepare(
          `SELECT title_key, title, count FROM shopping_history WHERE workspace_id = ?
           ORDER BY count DESC, last_at DESC LIMIT 40`,
        )
        .bind(workspaceId)
        .all<{ title_key: string; title: string; count: number }>(),
    ]);
    const onList = new Set(
      items.results.filter((i) => !i.checked).map((i) => shoppingKey(i.title)),
    );
    return {
      items: items.results.map(toItem),
      suggestions: history.results
        .filter((h) => !onList.has(h.title_key))
        .slice(0, 16)
        .map((h) => ({ title: h.title, count: h.count })),
    };
  }

  /** Adds items; a thing already on the list (not bought yet) is not added twice. */
  async add(
    workspaceId: string,
    userId: string,
    input: Out<typeof shoppingAddSchema>,
  ): Promise<ShoppingListDto> {
    const open = await this.db
      .prepare('SELECT title FROM shopping_items WHERE workspace_id = ? AND checked = 0')
      .bind(workspaceId)
      .all<{ title: string }>();
    const seen = new Set(open.results.map((r) => shoppingKey(r.title)));
    const now = Date.now();
    const fresh = input.items.filter((item) => {
      const key = shoppingKey(item.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (open.results.length + fresh.length > MAX_OPEN_ITEMS)
      fresh.splice(Math.max(0, MAX_OPEN_ITEMS - open.results.length));
    if (fresh.length)
      await this.db.batch(
        fresh.map((item, index) =>
          this.db
            .prepare(
              `INSERT INTO shopping_items (id, workspace_id, title, quantity, checked, created_by, created_at)
               VALUES (?, ?, ?, ?, 0, ?, ?)`,
            )
            .bind(crypto.randomUUID(), workspaceId, item.title, item.quantity, userId, now + index),
        ),
      );
    return this.list(workspaceId);
  }

  async update(
    workspaceId: string,
    id: string,
    input: Out<typeof shoppingUpdateSchema>,
  ): Promise<ShoppingItemDto> {
    const sets: string[] = [];
    const values: unknown[] = [];
    if (input.title !== undefined) {
      sets.push('title = ?');
      values.push(input.title);
    }
    if (input.quantity !== undefined) {
      sets.push('quantity = ?');
      values.push(input.quantity);
    }
    if (input.checked !== undefined) {
      sets.push('checked = ?', 'checked_at = ?');
      values.push(input.checked ? 1 : 0, input.checked ? Date.now() : null);
    }
    const row = await this.db
      .prepare(
        `UPDATE shopping_items SET ${sets.join(', ')} WHERE workspace_id = ? AND id = ?
         RETURNING id, title, quantity, checked, created_by, created_at, checked_at`,
      )
      .bind(...values, workspaceId, id)
      .first<ItemRow>();
    if (!row) throw notFound('SHOPPING_ITEM_NOT_FOUND');
    return toItem(row);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const result = await this.db
      .prepare('DELETE FROM shopping_items WHERE workspace_id = ? AND id = ?')
      .bind(workspaceId, id)
      .run();
    if (!result.meta.changes) throw notFound('SHOPPING_ITEM_NOT_FOUND');
  }

  /** Clears bought items and counts them into the history behind the suggestions. */
  async clearChecked(workspaceId: string): Promise<ShoppingListDto> {
    const checked = await this.db
      .prepare('SELECT title FROM shopping_items WHERE workspace_id = ? AND checked = 1')
      .bind(workspaceId)
      .all<{ title: string }>();
    const now = Date.now();
    await this.db.batch([
      ...checked.results.map((r) =>
        this.db
          .prepare(
            `INSERT INTO shopping_history (workspace_id, title_key, title, count, last_at)
             VALUES (?, ?, ?, 1, ?)
             ON CONFLICT(workspace_id, title_key) DO UPDATE SET count = count + 1,
               title = excluded.title, last_at = excluded.last_at`,
          )
          .bind(workspaceId, shoppingKey(r.title), r.title, now),
      ),
      this.db
        .prepare('DELETE FROM shopping_items WHERE workspace_id = ? AND checked = 1')
        .bind(workspaceId),
    ]);
    return this.list(workspaceId);
  }
}
