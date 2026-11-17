import { ERROR_MESSAGES, type ErrorCode, type ErrorParams } from '@homehub/shared';
import { t } from '@/i18n';

/**
 * Errors are shown by their code (`errors.<CODE>` in the dictionaries), never by the server's
 * message: the message is only a Russian fallback for a code this build does not know yet.
 */
export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value);

export function errorText(code: string, params?: ErrorParams, fallback?: string): string {
  if (isErrorCode(code)) return t(`errors.${code}`, { ...params });
  return fallback || t('layout.api.somethingWrong');
}

/** A field issue (from the server or from a schema in the browser) in the reader's language. */
export function issueText(issue: { code?: string; params?: ErrorParams; message: string }): string {
  return errorText(issue.code ?? issue.message, issue.params, issue.message);
}
