import type { MeDto } from '@homehub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

async function fetchMe(): Promise<MeDto | null> {
  try {
    const me = await api.get<MeDto>('/auth/me');
    setCsrfToken(me.csrfToken);
    return me;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function useMe() {
  return useQuery({ queryKey: queryKeys.me, queryFn: fetchMe, staleTime: 5 * 60_000 });
}

export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      setCsrfToken(null);
      client.clear();
      client.setQueryData(queryKeys.me, null);
    },
  });
}
