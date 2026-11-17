import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiNamespace from './api';

/**
 * The API client keeps the CSRF token and the demo/live mode in module state, so every test
 * imports a fresh copy of the module.
 */

type ApiModule = typeof ApiNamespace;

let fetchMock: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;
const originalLocation = window.location;

async function load(): Promise<ApiModule> {
  vi.resetModules();
  return import('./api');
}

function respond(status: number, body?: unknown) {
  fetchMock.mockResolvedValueOnce(
    body === undefined
      ? new Response(null, { status })
      : new Response(typeof body === 'string' ? body : JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
  );
}

function lastRequest(): { url: string; init: RequestInit; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

// The first import compiles the i18n dictionaries; later fresh imports reuse the transform.
beforeAll(async () => {
  await import('./api');
});

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('api client: CSRF', () => {
  it('sends cookies with every request and the CSRF token only on state-changing ones', async () => {
    const { api, setCsrfToken } = await load();
    setCsrfToken('csrf-1');

    respond(200, []);
    await api.get('/accounts');
    expect(lastRequest().init.credentials).toBe('include');
    expect(lastRequest().headers['X-CSRF-Token']).toBeUndefined();

    for (const call of [
      () => api.post('/accounts', { name: 'A' }),
      () => api.put('/x', {}),
      () => api.patch('/x', {}),
      () => api.delete('/x'),
    ]) {
      respond(200, {});
      await call();
      expect(lastRequest().headers['X-CSRF-Token']).toBe('csrf-1');
      expect(lastRequest().init.credentials).toBe('include');
    }
  });

  it('drops the token on logout (setCsrfToken(null))', async () => {
    const { api, setCsrfToken } = await load();
    setCsrfToken('csrf-1');
    setCsrfToken(null);
    respond(200, {});
    await api.post('/x', {});
    expect(lastRequest().headers['X-CSRF-Token']).toBeUndefined();
  });

  it('sends JSON bodies with a content type, and none without a body', async () => {
    const { api } = await load();
    respond(200, {});
    await api.post('/x', { a: 1 });
    expect(lastRequest().init.body).toBe('{"a":1}');
    expect(lastRequest().headers['Content-Type']).toBe('application/json');

    respond(204);
    await api.delete('/x');
    expect(lastRequest().init.body).toBeUndefined();
    expect(lastRequest().headers['Content-Type']).toBeUndefined();
  });
});

describe('api client: responses and errors', () => {
  it('builds the URL under /api and skips empty query values', async () => {
    const { api } = await load();
    respond(200, []);
    await api.get('/transactions', { month: '2026-10', account: '', page: 2, type: null });
    expect(lastRequest().url).toBe('/api/transactions?month=2026-10&page=2');
  });

  it('returns undefined for 204 and the parsed body otherwise', async () => {
    const { api } = await load();
    respond(204);
    await expect(api.delete('/x')).resolves.toBeUndefined();
    respond(200, { id: 'a' });
    await expect(api.get('/x')).resolves.toEqual({ id: 'a' });
  });

  it('turns an error body into ApiError with status, code, params and field issues', async () => {
    const { api, ApiError, errorMessage } = await load();
    const issue = {
      path: 'amount',
      code: 'VALIDATION_TOO_SMALL',
      params: { minimum: 1 },
      message: 'Не меньше 1',
    };
    respond(400, {
      statusCode: 400,
      error: 'VALIDATION_FAILED',
      message: 'Проверьте введенные данные',
      issues: [issue],
    });
    const error = await api.post('/x', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', issues: [issue] });
    expect(errorMessage(error)).toBe('Проверьте введенные данные');
  });

  it('keeps 401 recognisable for the session handling (status and code)', async () => {
    const { api } = await load();
    respond(401, {
      statusCode: 401,
      error: 'SESSION_EXPIRED',
      message: 'Сессия истекла, войдите снова',
    });
    await expect(api.get('/accounts')).rejects.toMatchObject({
      status: 401,
      code: 'SESSION_EXPIRED',
    });
  });

  it('a non-JSON error body still gives an ApiError with a generic message', async () => {
    const { api } = await load();
    respond(502, '<html>Bad gateway</html>');
    await expect(api.get('/x')).rejects.toMatchObject({
      status: 502,
      code: 'ERROR',
      message: 'Ошибка запроса',
    });
  });

  it('a network failure is an ApiError with status 0', async () => {
    const { api } = await load();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(api.get('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('errorMessage translates the code with its params, not the server message', async () => {
    const { ApiError, errorMessage } = await load();
    const similar = new ApiError(409, {
      error: 'VALIDATION_TOO_BIG',
      params: { maximum: '100' },
      message: 'stale server text',
    });
    expect(errorMessage(similar)).toBe('Не больше 100');
    // A code this build does not know yet falls back to the server's (Russian) message.
    expect(errorMessage(new ApiError(409, { error: 'NEW_CODE', message: 'Новая ошибка' }))).toBe(
      'Новая ошибка',
    );
    expect(errorMessage('boom')).toBe('Что-то пошло не так');
  });
});

describe('api client: demo/live mode', () => {
  it('learns the mode from /auth/me and sends it with later requests', async () => {
    const { api } = await load();
    respond(200, { user: {}, demoMode: false });
    await api.get('/auth/me');
    expect(lastRequest().headers['X-Homehub-Mode']).toBe('live');

    respond(200, {});
    await api.get('/accounts');
    expect(lastRequest().headers['X-Homehub-Mode']).toBe('live');

    const demo = await load();
    respond(200, { user: {}, demoMode: true });
    await demo.api.get('/auth/me');
    respond(200, {});
    await demo.api.get('/accounts');
    expect(lastRequest().headers['X-Homehub-Mode']).toBe('demo');
  });

  it('reloads when the mode changed in another tab', async () => {
    const { api } = await load();
    respond(200, { demoMode: false });
    await api.get('/auth/me');
    respond(200, { demoMode: true });
    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 409, code: 'MODE_CHANGED' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when the server answers MODE_CHANGED', async () => {
    const { api } = await load();
    respond(409, { statusCode: 409, error: 'MODE_CHANGED', message: 'Режим изменён' });
    await expect(api.post('/x', {})).rejects.toMatchObject({ code: 'MODE_CHANGED' });
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
