import type {
  AccountCreateInput,
  AccountDto,
  AccountUpdateInput,
  accountTopupSchema,
  BalanceDto,
  reconcileSchema,
} from '@homehub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { z } from 'zod';
import { api } from '@/lib/api';
import { invalidateMoney, queryKeys } from '@/lib/query-keys';

export function useAccounts() {
  return useQuery({
    queryKey: queryKeys.accounts,
    queryFn: () => api.get<AccountDto[]>('/accounts'),
  });
}

export function useAccountTotals() {
  return useQuery({
    queryKey: queryKeys.accountTotals,
    queryFn: () => api.get<BalanceDto[]>('/accounts/totals'),
  });
}

/** The account form shows a failure next to its fields, so no toast. */
export function useSaveAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: AccountCreateInput | AccountUpdateInput }) =>
      id ? api.patch<AccountDto>(`/accounts/${id}`, data) : api.post<AccountDto>('/accounts', data),
    onSuccess: () => invalidateMoney(client),
    meta: { silent: true },
  });
}

export function useArchiveAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.patch<AccountDto>(`/accounts/${id}`, { archived }),
    onSuccess: () => invalidateMoney(client),
  });
}

/** «Пополнить счет»: shown in its dialog on failure. */
export function useTopupAccount(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.output<typeof accountTopupSchema>) =>
      api.post<AccountDto>(`/accounts/${id}/topup`, input),
    onSuccess: () => invalidateMoney(client),
    meta: { silent: true },
  });
}

/** «Сверить остаток»: shown in its dialog on failure. */
export function useReconcileAccount(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: z.output<typeof reconcileSchema>) =>
      api.post<AccountDto>(`/accounts/${id}/reconcile`, input),
    onSuccess: () => invalidateMoney(client),
    meta: { silent: true },
  });
}
