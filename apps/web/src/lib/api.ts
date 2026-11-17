import type { ApiErrorBody, ErrorParams } from '@homehub/shared';
import { t } from '@/i18n';
import { errorText } from './errors';

export const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') || '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly params: ErrorParams | undefined;
  readonly issues: NonNullable<ApiErrorBody['issues']>;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? t('layout.api.requestError'));
    this.status = status;
    this.code = body.error ?? 'ERROR';
    this.params = body.params;
    this.issues = body.issues ?? [];
  }
}

let csrfToken: string | null = null;
let demoMode: boolean | null = null;
let unauthorized: (() => void) | null = null;

/**
 * Called on any 401 — from a query, a mutation or a plain `api.*` call — so an expired session
 * always leads to the sign-in page instead of a toast (registered by the query client).
 */
export function onUnauthorized(handler: (() => void) | null): void {
  unauthorized = handler;
}

/** The token comes from GET /auth/me and lives only in memory, never in storage. */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
  if (token === null) demoMode = null;
}

type QueryValue = string | number | undefined | null;

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${API_URL}${path}${search ? `?${search}` : ''}`;
}

async function request<T>(
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, QueryValue> } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Homehub-Mode': demoMode ? 'demo' : 'live',
  };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: 'include',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new ApiError(0, { error: 'NETWORK', message: t('layout.api.noConnection') });
  }

  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) unauthorized?.();
    if ((data as Partial<ApiErrorBody>).error === 'MODE_CHANGED') window.location.reload();
    throw new ApiError(response.status, data as Partial<ApiErrorBody>);
  }
  if (path === '/auth/me') {
    const nextMode = Boolean((data as { demoMode?: boolean }).demoMode);
    if (demoMode !== null && demoMode !== nextMode) {
      window.location.reload();
      throw new ApiError(409, {
        error: 'MODE_CHANGED',
        message: t('layout.api.modeChanged'),
      });
    }
    demoMode = nextMode;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Record<string, QueryValue>) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

/** What to tell the user about a failed request, in their language (by the error's code). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // Errors made in the browser (no connection, mode change) already carry a translated text.
    if (error.status === 0 || error.code === 'MODE_CHANGED') return error.message;
    return errorText(error.code, error.params, error.message);
  }
  return t('layout.api.somethingWrong');
}
