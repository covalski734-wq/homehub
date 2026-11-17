import type { CategoryDto } from '@homehub/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useCategories() {
  return useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => api.get<CategoryDto[]>('/categories'),
    staleTime: 10 * 60_000,
  });
}
