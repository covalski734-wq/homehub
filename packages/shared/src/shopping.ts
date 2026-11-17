import { z } from 'zod';

/**
 * The household's shared shopping list (groceries and everyday things, unlike the planned
 * purchases of the budget). Items are added in one go, ticked off in the store and cleared
 * afterwards; cleared items feed «often bought» suggestions.
 */

export const SHOPPING_TITLE_MAX = 80;

const title = z
  .string()
  .trim()
  .min(1, 'VALIDATION_SHOPPING_TITLE_REQUIRED')
  .max(SHOPPING_TITLE_MAX, 'VALIDATION_TOO_LONG');
const quantity = z.string().trim().max(30, 'VALIDATION_TOO_LONG');

export const shoppingAddSchema = z.object({
  items: z
    .array(z.object({ title, quantity: quantity.default('') }))
    .min(1)
    .max(50),
});
export type ShoppingAddInput = z.input<typeof shoppingAddSchema>;

export const shoppingUpdateSchema = z
  .object({ title, quantity, checked: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'VALIDATION_NO_CHANGES');
export type ShoppingUpdateInput = z.input<typeof shoppingUpdateSchema>;

export interface ShoppingItemDto {
  id: string;
  title: string;
  quantity: string;
  checked: boolean;
  createdBy: string | null;
  createdAt: string;
  checkedAt: string | null;
}

export interface ShoppingSuggestionDto {
  title: string;
  count: number;
}

export interface ShoppingListDto {
  items: ShoppingItemDto[];
  /** Most often bought, not on the list right now. */
  suggestions: ShoppingSuggestionDto[];
}

/** Splits «молоко, хлеб 2 шт; яйца x10» into items with an optional trailing quantity. */
export function parseShoppingText(text: string): { title: string; quantity: string }[] {
  return (
    text
      // A comma between digits is a decimal one («1,5 л»), not a separator.
      .split(/[\n;]+|,(?!\d)/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const match =
          /^(.*?)\s+((?:x|х|×)?\s*\d+(?:[.,]\d+)?\s*(?:шт|кг|г|л|мл|уп|пач|бут|банк)?\.?)$/i.exec(
            part,
          );
        return match && match[1]
          ? { title: match[1].trim(), quantity: match[2]!.trim() }
          : { title: part, quantity: '' };
      })
      .map((item) => ({
        title: item.title.slice(0, SHOPPING_TITLE_MAX),
        quantity: item.quantity.slice(0, 30),
      }))
  );
}

/** Case- and spacing-insensitive key used to merge duplicates and count history. */
export const shoppingKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
