import type { z } from 'zod';
import { ERROR_MESSAGES, errorMessage, type ErrorCode, type ErrorParams } from './errors/index';

/**
 * Field errors of a Zod validation as codes. A schema's own message is an error code
 * (`.min(1, 'VALIDATION_NAME_REQUIRED')`); an issue without one gets a generic code from its kind,
 * with the limit as a parameter. The same function runs in the browser (forms) and on the server
 * (`issues` of a 400 response), so a field error reads the same everywhere and in every language.
 */
export interface FieldIssue {
  path: string;
  code: ErrorCode;
  params?: ErrorParams;
  /** Russian fallback. */
  message: string;
}

const isCode = (value: string): value is ErrorCode => value in ERROR_MESSAGES;

function limit(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  return undefined;
}

export function issueCode(issue: z.core.$ZodIssue): { code: ErrorCode; params?: ErrorParams } {
  if (isCode(issue.message)) {
    const params: ErrorParams = {};
    if (issue.code === 'too_small' && limit(issue.minimum) !== undefined)
      params.minimum = limit(issue.minimum) ?? 0;
    if (issue.code === 'too_big' && limit(issue.maximum) !== undefined)
      params.maximum = limit(issue.maximum) ?? 0;
    return { code: issue.message, params: Object.keys(params).length ? params : undefined };
  }
  switch (issue.code) {
    case 'too_small': {
      const minimum = limit(issue.minimum) ?? 0;
      if (issue.origin === 'string')
        return minimum <= 1
          ? { code: 'VALIDATION_REQUIRED' }
          : { code: 'VALIDATION_TOO_SHORT', params: { minimum } };
      return { code: 'VALIDATION_TOO_SMALL', params: { minimum } };
    }
    case 'too_big': {
      const maximum = limit(issue.maximum) ?? 0;
      return issue.origin === 'string'
        ? { code: 'VALIDATION_TOO_LONG', params: { maximum } }
        : { code: 'VALIDATION_TOO_BIG', params: { maximum } };
    }
    case 'invalid_type':
      return issue.input === undefined
        ? { code: 'VALIDATION_REQUIRED' }
        : { code: 'VALIDATION_INVALID' };
    default:
      return { code: 'VALIDATION_INVALID' };
  }
}

export function fieldIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => {
    const { code, params } = issueCode(issue);
    return {
      path: issue.path.join('.'),
      code,
      ...(params ? { params } : {}),
      message: errorMessage(code, params),
    };
  });
}
