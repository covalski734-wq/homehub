import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import { ApiError, errorMessage } from './api';
import { issueText } from './errors';

/**
 * Puts server-side validation issues next to the matching fields.
 * Returns a message for the form-level alert when the error is not field-specific.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly string[],
): string | null {
  if (error instanceof ApiError && error.issues.length > 0) {
    const unmatched: string[] = [];
    for (const issue of error.issues) {
      const message = issueText(issue);
      if (fields.includes(issue.path)) setError(issue.path as Path<T>, { type: 'server', message });
      else unmatched.push(message);
    }
    return unmatched.length > 0 ? unmatched.join('. ') : null;
  }
  return errorMessage(error);
}
