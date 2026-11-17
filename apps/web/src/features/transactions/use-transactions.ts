import type {
  Paginated,
  TransactionDto,
  TransactionInput,
  TransactionQueryInput,
} from '@homehub/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { invalidateMoney, queryKeys } from '@/lib/query-keys';

export function useTransactions(query: TransactionQueryInput) {
  return useQuery({
    queryKey: queryKeys.transactions(query),
    queryFn: () => api.get<Paginated<TransactionDto>>('/transactions', { ...query }),
    placeholderData: keepPreviousData,
  });
}

export function useSaveTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: TransactionInput }) =>
      id
        ? api.put<TransactionDto>(`/transactions/${id}`, data)
        : api.post<TransactionDto>('/transactions', data),
    onSuccess: () => invalidateMoney(client),
    // The form shows the failure next to its fields.
    meta: { silent: true },
  });
}

export function useDeleteTransaction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/transactions/${id}`),
    onSuccess: () => invalidateMoney(client),
  });
}
