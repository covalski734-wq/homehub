import type {
  ActualPaymentInput,
  IncomeLineDto,
  MemberCreateInput,
  MemberDto,
  ItemSharesInput,
  MemberUpdateInput,
  MonthBudgetDto,
  ScenarioMonthInput,
  ScenariosDto,
  ScenarioUpdateInput,
  WealthDto,
} from '@homehub/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { invalidateMoney, roots } from '@/lib/query-keys';

export const householdKeys = {
  members: roots.members,
  wealth: (month: string) => [...roots.wealth, month] as const,
  scenarios: (from: string, months: number) => [...roots.scenarios, from, months] as const,
};

export function useMembers() {
  return useQuery({
    queryKey: householdKeys.members,
    queryFn: () => api.get<MemberDto[]>('/members'),
    staleTime: 5 * 60_000,
  });
}

export function useMemberMutations() {
  const client = useQueryClient();
  const onSuccess = (members: MemberDto[]) => client.setQueryData(householdKeys.members, members);
  return {
    create: useMutation({
      mutationFn: (input: MemberCreateInput) => api.post<MemberDto[]>('/members', input),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: MemberUpdateInput }) =>
        api.patch<MemberDto[]>(`/members/${id}`, data),
      onSuccess,
    }),
  };
}

export function useWealth(month: string) {
  return useQuery({
    queryKey: householdKeys.wealth(month),
    queryFn: () => api.get<WealthDto>('/savings/wealth', { month }),
    placeholderData: keepPreviousData,
  });
}

export function useScenarios(from: string, months: number) {
  return useQuery({
    queryKey: householdKeys.scenarios(from, months),
    queryFn: () => api.get<ScenariosDto>('/scenarios', { from, months }),
    placeholderData: keepPreviousData,
  });
}

export function useScenarioMutation(from: string, months: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ScenarioUpdateInput) =>
      api.put<ScenariosDto>(`/scenarios?from=${from}&months=${months}`, input),
    onSuccess: (data) => client.setQueryData(householdKeys.scenarios(from, months), data),
  });
}

export function useScenarioMonthMutation(from: string, months: number) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ScenarioMonthInput) =>
      api.put<ScenariosDto>(`/scenarios/months?from=${from}&months=${months}`, input),
    onSuccess: (data) => client.setQueryData(householdKeys.scenarios(from, months), data),
  });
}

/**
 * Shares of a joint line between members for the month; an empty list returns it to the default
 * split. The form shows a failure in place, so there is no toast.
 */
export function useSaveShares(month: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ItemSharesInput }) =>
      api.put<MonthBudgetDto>(`/planner/shares/${id}?month=${month}`, data),
    onSuccess: () => void invalidateMoney(client),
    meta: { silent: true },
  });
}

export function useIncomeReceipt(month: string) {
  const client = useQueryClient();
  return {
    receive: useMutation({
      mutationFn: ({ id, data }: { id: string; data: ActualPaymentInput }) =>
        api.put<IncomeLineDto>(`/planner/incomes/${id}/receipt`, { ...data, month }),
      onSuccess: () => void invalidateMoney(client),
    }),
    undo: useMutation({
      mutationFn: (id: string) =>
        api.delete<IncomeLineDto>(`/planner/incomes/${id}/receipt?month=${month}`),
      onSuccess: () => void invalidateMoney(client),
    }),
  };
}
