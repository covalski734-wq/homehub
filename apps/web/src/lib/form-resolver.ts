import { fieldIssues } from '@homehub/shared';
import type { FieldError, FieldErrors, FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';
import { issueText } from './errors';

/**
 * react-hook-form resolver for the shared Zod schemas. Like the server (lib/validation.ts), it
 * turns issues into error codes (validation-issues.ts), so a field shows the same text in the
 * browser and after a server check, in the reader's language. The error `type` is the code.
 */
export function schemaResolver<TSchema extends z.ZodType<FieldValues, FieldValues>>(
  schema: TSchema,
): Resolver<z.input<TSchema>, unknown, z.output<TSchema>> {
  return async (values) => {
    const result = schema.safeParse(values);
    if (result.success) return { values: result.data, errors: {} };
    const errors: Record<string, unknown> = {};
    for (const issue of fieldIssues(result.error)) {
      const path = issue.path ? issue.path.split('.') : ['root'];
      let target = errors;
      path.forEach((segment, index) => {
        if (index === path.length - 1) {
          // The first issue of a field wins, as in zodResolver.
          if (!target[segment])
            target[segment] = { type: issue.code, message: issueText(issue) } satisfies FieldError;
          return;
        }
        const next = target[segment];
        if (typeof next === 'object' && next !== null && !('type' in next))
          target = next as Record<string, unknown>;
        else target = target[segment] = {};
      });
    }
    return { values: {}, errors: errors as FieldErrors<z.input<TSchema>> };
  };
}
