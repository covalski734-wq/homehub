import { ACCESS_ERRORS } from './access';
import { AUTH_ERRORS } from './auth';
import { CHORES_ERRORS } from './chores';
import { COMMON_ERRORS } from './common';
import { DEMO_ERRORS } from './demo';
import { FINANCE_ERRORS } from './finance';
import { PLANNER_ERRORS } from './planner';
import { SAVINGS_ERRORS } from './savings';
import { SHOPPING_ERRORS } from './shopping';
import { VALIDATION_ERRORS } from './validation';

/**
 * Error codes of the API. A response carries the code, its parameters and a Russian fallback
 * message (`{ error, params, message }`); the client shows `errors.<CODE>` from its dictionary in
 * the reader's language, never the message. The Russian templates (one file per module) are that
 * fallback and the reference the web dictionaries are checked against
 * (apps/web/src/i18n/dictionary.test.ts).
 *
 * Parameters are plain strings or numbers: names, formatted amounts, currencies, months.
 */
export const ERROR_MESSAGES = {
  ...COMMON_ERRORS,
  ...SAVINGS_ERRORS,
  ...AUTH_ERRORS,
  ...CHORES_ERRORS,
  ...DEMO_ERRORS,
  ...SHOPPING_ERRORS,
  ...FINANCE_ERRORS,
  ...PLANNER_ERRORS,
  ...VALIDATION_ERRORS,
  ...ACCESS_ERRORS,
} as const;

export type ErrorCode = keyof typeof ERROR_MESSAGES;
export type ErrorParams = Record<string, string | number>;

/** The Russian fallback message of a code with its parameters filled in. */
export function errorMessage(code: ErrorCode, params?: ErrorParams): string {
  return ERROR_MESSAGES[code].replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) =>
    String(params?.[name] ?? ''),
  );
}
