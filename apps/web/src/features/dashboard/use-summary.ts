import type { FinanceSummaryDto } from '@homehub/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useSummary(month: string) {
  return useQuery({
    queryKey: queryKeys.summary(month),
    queryFn: () => api.get<FinanceSummaryDto>('/finance/summary', { month }),
    placeholderData: keepPreviousData,
  });
}
