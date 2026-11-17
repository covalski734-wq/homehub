import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
import { createQueryClient } from './query-client';
import { queryKeys } from './query-keys';

const ME = { user: { id: 'u1' }, csrfToken: 't' };
const expired = () => new ApiError(401, { error: 'SESSION_EXPIRED', message: 'Сессия истекла' });

describe('query client: session handling', () => {
  it('a 401 from a query drops the cached user (the app goes to /login)', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    await client
      .fetchQuery({
        queryKey: ['accounts'],
        queryFn: () => Promise.reject(expired()),
        retry: false,
      })
      .catch(() => undefined);
    expect(client.getQueryData(queryKeys.me)).toBeNull();
  });

  it('a 401 from a mutation drops the cached user', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(expired()),
    });
    await mutation.execute(undefined).catch(() => undefined);
    expect(client.getQueryData(queryKeys.me)).toBeNull();
  });

  it('other errors keep the user', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    await client
      .fetchQuery({
        queryKey: ['accounts'],
        queryFn: () => Promise.reject(new ApiError(403, { error: 'CSRF_TOKEN' })),
        retry: false,
      })
      .catch(() => undefined);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError(409, { error: 'CONFLICT' })),
    });
    await mutation.execute(undefined).catch(() => undefined);
    expect(client.getQueryData(queryKeys.me)).toEqual(ME);
  });

  it('a 401 from a plain api call (outside react-query) drops the cached user too', async () => {
    const client = createQueryClient();
    client.setQueryData(queryKeys.me, ME);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ error: 'SESSION_EXPIRED' }), { status: 401 }),
      ),
    );
    await api.post('/planner/incomes', {}).catch(() => undefined);
    vi.unstubAllGlobals();
    expect(client.getQueryData(queryKeys.me)).toBeNull();
  });

  it('a failed mutation without its own handler is shown as a toast', async () => {
    const client = createQueryClient();
    const shown = vi.spyOn(toast, 'error');
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError(404, { error: 'FINANCE_ACCOUNT_NOT_FOUND' })),
    });
    await mutation.execute(undefined).catch(() => undefined);
    expect(shown).toHaveBeenCalledWith('Счет не найден');
    shown.mockClear();
    const handled = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError(404, { error: 'FINANCE_ACCOUNT_NOT_FOUND' })),
      onError: () => undefined,
    });
    await handled.execute(undefined).catch(() => undefined);
    expect(shown).not.toHaveBeenCalled();
  });

  it('never retries client errors; retries server and network errors twice', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (
      failureCount: number,
      error: unknown,
    ) => boolean;
    expect(retry(0, expired())).toBe(false);
    expect(retry(0, new ApiError(404, {}))).toBe(false);
    expect(retry(0, new ApiError(500, {}))).toBe(true);
    expect(retry(1, new ApiError(0, { error: 'NETWORK' }))).toBe(true);
    expect(retry(2, new ApiError(503, {}))).toBe(false);
  });
});
