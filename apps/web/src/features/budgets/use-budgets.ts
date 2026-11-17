import type { BudgetDto, BudgetUpsertInput } from '@homehub/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

export function useBudgets(month: string) {
  return useQuery({
    queryKey: queryKeys.budgets(month),
    queryFn: () => api.get<BudgetDto[]>('/budgets', { month }),
    placeholderData: keepPreviousData,
  });
}

function useInvalidateBudgets() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.budgetsRoot });
}

export function useSaveBudget() {
  const invalidate = useInvalidateBudgets();
  return useMutation({
    mutationFn: (data: BudgetUpsertInput) => api.put<BudgetDto>('/budgets', data),
    onSuccess: invalidate,
    // The form shows the failure next to its fields.
    meta: { silent: true },
  });
}

export function useDeleteBudget() {
  const invalidate = useInvalidateBudgets();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/budgets/${id}`),
    onSuccess: invalidate,
  });
}

export function useCopyBudgets() {
  const invalidate = useInvalidateBudgets();
  return useMutation({
    mutationFn: (data: { fromMonth: string; toMonth: string }) =>
      api.post<{ copied: number }>('/budgets/copy', data),
    onSuccess: invalidate,
  });
}
