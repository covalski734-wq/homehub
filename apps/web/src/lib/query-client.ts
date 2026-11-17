import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, errorMessage, onUnauthorized } from './api';
import { queryKeys } from './query-keys';

function isUnauthorized(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}

/**
 * Any 401 (expired or revoked session) drops the cached user, which sends the app to /login —
 * whichever way the request was made. A failed change that has no error handler of its own shows
 * the error as a toast, so no failure goes unseen.
 */
export function createQueryClient(): QueryClient {
  const signOut = () => client.setQueryData(queryKeys.me, null);
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauthorized(error)) signOut();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (isUnauthorized(error)) signOut();
        else if (!mutation.options.onError && !mutation.meta?.silent)
          toast.error(errorMessage(error));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
      },
    },
  });
  onUnauthorized(signOut);
  return client;
}
