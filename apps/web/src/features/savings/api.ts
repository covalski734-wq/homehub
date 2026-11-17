import type {
  FundPartEventDto,
  MovementUpdateInput,
  AutoAmountInput,
  AutoRuleCreateInput,
  FundOverrideInput,
  FundRuleInput,
  PositionUpdateInput,
  SubaccountCreateInput,
  SubaccountUpdateInput,
  AssetDto,
  MovementCreateInput,
  MovementDto,
  PositionCreateInput,
  PotCreateInput,
  PotUpdateInput,
  SavingsOverviewDto,
} from '@homehub/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { invalidateMoney, roots } from '@/lib/query-keys';

export const savingsKeys = {
  root: roots.savings,
  month: (month: string) => [...roots.savings, month] as const,
  assets: (query: string) => [...roots.savings, 'assets', query] as const,
  history: (potId: string) => [...roots.savings, 'history', potId] as const,
};

export function useSavings(month: string) {
  return useQuery({
    queryKey: savingsKeys.month(month),
    queryFn: () => api.get<SavingsOverviewDto>('/savings', { month }),
    placeholderData: keepPreviousData,
  });
}

/** CoinGecko search through the API; nothing is asked for under two characters. */
export function useAssetSearch(query: string) {
  const q = query.trim();
  return useQuery({
    queryKey: savingsKeys.assets(q.toLowerCase()),
    queryFn: () => api.get<AssetDto[]>('/savings/assets', { q }),
    enabled: q.length >= 2,
    staleTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });
}

/** Every movement of a fund, all months (newest first). */
export function useMovementHistory(potId: string) {
  return useQuery({
    queryKey: savingsKeys.history(potId),
    queryFn: () => api.get<MovementDto[]>(`/savings/pots/${potId}/movements`),
  });
}

export function usePartHistory(potId: string) {
  return useQuery({
    queryKey: [...savingsKeys.root, 'part-history', potId],
    queryFn: () => api.get<FundPartEventDto[]>(`/savings/pots/${potId}/part-history`),
  });
}

interface MutationOptions {
  /** The form shows the failure in place: no toast. */
  silent?: boolean;
}

/**
 * Every change answers with the month overview. A change that moves money — deposits and
 * withdrawals (account transfers, returns as planner payments), parts on accounts, plans and
 * automatic operations — refreshes everything that shows money (invalidateMoney). The others
 * (names, positions, prices) only touch savings, wealth and scenarios.
 */
function useOverviewMutation<T>(
  fn: (input: T) => Promise<SavingsOverviewDto>,
  money: boolean,
  { silent = false }: MutationOptions,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    meta: silent ? { silent } : undefined,
    onSuccess: (overview: SavingsOverviewDto) => {
      client.setQueryData(savingsKeys.month(overview.month), overview);
      if (money) {
        void invalidateMoney(client);
        return;
      }
      // Other months show the same balances; search results stay.
      void client.invalidateQueries({
        queryKey: savingsKeys.root,
        predicate: (query) => ![overview.month, 'assets'].includes(String(query.queryKey[1])),
      });
      void client.invalidateQueries({ queryKey: roots.wealth });
      void client.invalidateQueries({ queryKey: roots.scenarios });
    },
  });
}

export function useSavingsMutations(month: string, options: MutationOptions = {}) {
  const q = `?month=${month}`;
  return {
    createPot: useOverviewMutation(
      (input: PotCreateInput) => api.post<SavingsOverviewDto>(`/savings/pots${q}`, input),
      false,
      options,
    ),
    updatePot: useOverviewMutation(
      ({ id, data }: { id: string; data: PotUpdateInput }) =>
        api.patch<SavingsOverviewDto>(`/savings/pots/${id}${q}`, data),
      false,
      options,
    ),
    deletePot: useOverviewMutation(
      (id: string) => api.delete<SavingsOverviewDto>(`/savings/pots/${id}${q}`),
      true,
      options,
    ),
    addMovement: useOverviewMutation(
      ({ potId, data }: { potId: string; data: MovementCreateInput }) =>
        api.post<SavingsOverviewDto>(`/savings/pots/${potId}/movements${q}`, data),
      true,
      options,
    ),
    updateMovement: useOverviewMutation(
      ({ id, data }: { id: string; data: MovementUpdateInput }) =>
        api.patch<SavingsOverviewDto>(`/savings/movements/${id}${q}`, data),
      true,
      options,
    ),
    deleteMovement: useOverviewMutation(
      (id: string) => api.delete<SavingsOverviewDto>(`/savings/movements/${id}${q}`),
      true,
      options,
    ),
    setReturned: useOverviewMutation(
      ({ id, returned }: { id: string; returned: boolean }) =>
        api.put<SavingsOverviewDto>(`/savings/movements/${id}/returned${q}`, { returned }),
      true,
      options,
    ),
    moveReturn: useOverviewMutation(
      ({ id, repayMonth }: { id: string; repayMonth: string }) =>
        api.put<SavingsOverviewDto>(`/savings/movements/${id}/repay-month${q}`, { repayMonth }),
      true,
      options,
    ),
    addPosition: useOverviewMutation(
      ({ potId, data }: { potId: string; data: PositionCreateInput }) =>
        api.post<SavingsOverviewDto>(`/savings/pots/${potId}/positions${q}`, data),
      false,
      options,
    ),
    updatePosition: useOverviewMutation(
      ({ id, data }: { id: string; data: PositionUpdateInput }) =>
        api.patch<SavingsOverviewDto>(`/savings/positions/${id}${q}`, data),
      false,
      options,
    ),
    deletePosition: useOverviewMutation(
      (id: string) => api.delete<SavingsOverviewDto>(`/savings/positions/${id}${q}`),
      false,
      options,
    ),
    deletePart: useOverviewMutation(
      (id: string) => api.delete<SavingsOverviewDto>(`/savings/subaccounts/${id}${q}`),
      true,
      options,
    ),
    confirmPlan: useOverviewMutation(
      (id: string) => api.post<SavingsOverviewDto>(`/savings/subaccounts/${id}/confirm-plan${q}`),
      true,
      options,
    ),
    confirmAuto: useOverviewMutation(
      (id: string) => api.post<SavingsOverviewDto>(`/savings/auto/${id}/confirm${q}`),
      true,
      options,
    ),
    createPart: useOverviewMutation(
      ({ potId, data }: { potId: string; data: SubaccountCreateInput }) =>
        api.post<SavingsOverviewDto>(`/savings/pots/${potId}/subaccounts${q}`, data),
      true,
      options,
    ),
    updatePart: useOverviewMutation(
      ({ id, data }: { id: string; data: SubaccountUpdateInput }) =>
        api.patch<SavingsOverviewDto>(`/savings/subaccounts/${id}${q}`, data),
      true,
      options,
    ),
    setRule: useOverviewMutation(
      ({ id, data }: { id: string; data: FundRuleInput }) =>
        api.put<SavingsOverviewDto>(`/savings/subaccounts/${id}/rule${q}`, data),
      true,
      options,
    ),
    deleteRule: useOverviewMutation(
      (id: string) => api.delete<SavingsOverviewDto>(`/savings/subaccounts/${id}/rule${q}`),
      true,
      options,
    ),
    setOverride: useOverviewMutation(
      ({ id, data }: { id: string; data: FundOverrideInput }) =>
        api.put<SavingsOverviewDto>(`/savings/subaccounts/${id}/plan${q}`, data),
      true,
      options,
    ),
    createAuto: useOverviewMutation(
      ({ partId, data }: { partId: string; data: AutoRuleCreateInput }) =>
        api.post<SavingsOverviewDto>(`/savings/subaccounts/${partId}/auto${q}`, data),
      true,
      options,
    ),
    setAutoAmount: useOverviewMutation(
      ({ id, data }: { id: string; data: AutoAmountInput }) =>
        api.put<SavingsOverviewDto>(`/savings/auto/${id}/amount${q}`, data),
      true,
      options,
    ),
    deleteAuto: useOverviewMutation(
      (id: string) => api.delete<SavingsOverviewDto>(`/savings/auto/${id}${q}`),
      true,
      options,
    ),
    refreshPrices: useOverviewMutation(
      () => api.post<SavingsOverviewDto>(`/savings/prices/refresh${q}`),
      false,
      options,
    ),
  };
}
