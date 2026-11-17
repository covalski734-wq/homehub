import { errorMessage, type ApiErrorBody, type ErrorCode, type ErrorParams } from '@homehub/shared';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'VALIDATION_FAILED',
  500: 'INTERNAL',
  503: 'SERVICE_UNAVAILABLE',
};

/** A field error: the path in the input and a code from ERROR_MESSAGES / validation codes. */
export type Issue = { path: string; code: string; params?: ErrorParams; message: string };

/**
 * An expected error. The client gets a stable code with its parameters (and a Russian fallback
 * message); everything else becomes a generic 500.
 */
export class HttpError extends Error {
  readonly code: ErrorCode;
  readonly params?: ErrorParams;
  readonly issues?: Issue[];

  constructor(
    readonly status: number,
    code?: ErrorCode,
    params?: ErrorParams,
    issues?: Issue[],
  ) {
    const resolved = code ?? STATUS_CODES[status] ?? 'INTERNAL';
    super(errorMessage(resolved, params));
    this.code = resolved;
    this.params = params;
    this.issues = issues;
  }

  toBody(): ApiErrorBody {
    return {
      statusCode: this.status,
      error: this.code,
      message: this.message,
      ...(this.params ? { params: this.params } : {}),
      ...(this.issues ? { issues: this.issues } : {}),
    };
  }
}

export const badRequest = (code: ErrorCode = 'BAD_REQUEST', issues?: Issue[]) =>
  new HttpError(400, code, undefined, issues);
export const notFound = (code: ErrorCode = 'NOT_FOUND', params?: ErrorParams) =>
  new HttpError(404, code, params);
export const conflict = (code: ErrorCode = 'CONFLICT', params?: ErrorParams) =>
  new HttpError(409, code, params);
export const unprocessable = (code: ErrorCode, params?: ErrorParams) =>
  new HttpError(422, code, params);
export const unavailable = (code: ErrorCode = 'SERVICE_UNAVAILABLE', params?: ErrorParams) =>
  new HttpError(503, code, params);

/**
 * Database constraint/trigger violations → HTTP errors. Triggers raise messages prefixed
 * with "HH_" (see migrations 0001, 0003, 0006, 0023).
 */
const DB_ERRORS: [RegExp, () => HttpError][] = [
  [/HH_CURRENCY_MISMATCH/, () => conflict('DB_CURRENCY_MISMATCH')],
  [/HH_ACCOUNT_HAS_TRANSACTIONS/, () => conflict('DB_ACCOUNT_HAS_TRANSACTIONS')],
  [/HH_CATEGORY_KIND/, () => unprocessable('DB_CATEGORY_KIND')],
  [/HH_TRANSFER_AMOUNT/, () => unprocessable('DB_TRANSFER_AMOUNT')],
  [/HH_BUDGET_CATEGORY_KIND/, () => unprocessable('DB_BUDGET_CATEGORY_KIND')],
  [/HH_WORKSPACE_IMMUTABLE/, () => conflict('DB_WORKSPACE_IMMUTABLE')],
  [/HH_WORKSPACE_MISMATCH/, () => unprocessable('DB_WORKSPACE_MISMATCH')],
  [/HH_APPEND_ONLY/, () => conflict('DB_APPEND_ONLY')],
  // A batch_guard nobody translated into a specific error: the data changed meanwhile.
  [/HH_GUARD_FAILED/, () => conflict('CONFLICT')],
  [/UNIQUE constraint failed/, () => conflict('DB_DUPLICATE')],
  [/FOREIGN KEY constraint failed/, () => conflict('DB_IN_USE')],
  [/CHECK constraint failed/, () => unprocessable('DB_CONSTRAINT')],
];

function errorMessages(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' | ');
}

export function fromDatabaseError(error: unknown): HttpError | null {
  const message = errorMessages(error);
  const match = DB_ERRORS.find(([pattern]) => pattern.test(message));
  return match ? match[1]() : null;
}

export function isUniqueViolation(error: unknown, column: string): boolean {
  return new RegExp(`UNIQUE constraint failed: [^|]*${column}`).test(errorMessages(error));
}
