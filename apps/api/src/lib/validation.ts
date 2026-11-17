import { fieldIssues } from '@homehub/shared';
import type { Context } from 'hono';
import type { z } from 'zod';
import { badRequest } from './http-error';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Validates input with a schema from @homehub/shared — the same rules as the browser forms. */
export function parseWith<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw badRequest('VALIDATION_FAILED', fieldIssues(result.error));
}

export async function parseBody<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema,
): Promise<z.output<TSchema>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('VALIDATION_INVALID_JSON');
  }
  return parseWith(schema, body);
}

export function parseQuery<TSchema extends z.ZodType>(
  c: Context,
  schema: TSchema,
): z.output<TSchema> {
  return parseWith(schema, c.req.query());
}

export function uuidParam(c: Context, name = 'id'): string {
  const value = c.req.param(name) ?? '';
  if (!UUID_PATTERN.test(value)) throw badRequest('VALIDATION_UUID');
  return value;
}
