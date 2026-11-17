import type {
  ActualPaymentInput,
  AmountChangeInput,
  DashboardLayout,
  DeductionCreateInput,
  DeductionUpdateInput,
  IncomeCreateInput,
  IncomeLineDto,
  IncomeUpdateInput,
  LoansDto,
  MonthBudgetDto,
  PlannerSettingsDto,
  PlannerSettingsUpdate,
  PlannerTrendDto,
  PurchaseCompleteInput,
  PurchaseCreateInput,
  PurchaseDto,
  PurchaseEventDto,
  PurchaseStatus,
  PurchaseUpdateInput,
  RatesStatusDto,
  RecurringCreateInput,
  RecurringLineDto,
  RecurringUpdateInput,
} from '@homehub/shared';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { removeRow, upsertRow } from '@/lib/query-cache';
import { invalidateMoney, roots } from '@/lib/query-keys';

const P = '/planner';

const monthsKey = [...roots.planner, 'month'] as const;
const trendsKey = [...roots.planner, 'trend'] as const;
const loansKey = [...roots.planner, 'loans'] as const;
const incomesKey = [...roots.planner, 'incomes'] as const;
const recurringKey = [...roots.planner, 'recurring'] as const;
const purchasesKey = [...roots.planner, 'purchases'] as const;

export const plannerKeys = {
  root: roots.planner,
  settings: [...roots.planner, 'settings'] as const,
  layout: [...roots.planner, 'layout'] as const,
  months: monthsKey,
  month: (month: string) => [...monthsKey, month] as const,
  trends: trendsKey,
  trend: (to: string, months: number) => [...trendsKey, to, months] as const,
  loans: (month: string) => [...loansKey, month] as const,
  incomesAll: incomesKey,
  incomes: (month: string) => [...incomesKey, month] as const,
  recurringAll: recurringKey,
  recurring: (month: string) => [...recurringKey, month] as const,
  purchases: purchasesKey,
  purchaseHistory: (id: string) => [...purchasesKey, id, 'history'] as const,
  rates: [...roots.planner, 'rates'] as const,
};

/**
 * A plan line changed without moving money: month budgets, trends and loans are recomputed, and
 * so are the fund plans (savings follow what the plan leaves free).
 */
function refreshPlanTotals(client: QueryClient) {
  for (const queryKey of [plannerKeys.months, plannerKeys.trends, loansKey, roots.savings])
    void client.invalidateQueries({ queryKey });
}

/**
 * Row edits whose errors the caller already shows in place: the editable table marks the cell
 * and toasts, the payment toggle, the fact dialog and the «left to pay» card handle theirs.
 * Without this the global handler would toast the same error a second time.
 */
const shownByCaller = { silent: true } as const;

// ---- settings, layout, budgets ----------------------------------------------------------------

export function usePlannerSettings() {
  return useQuery({
    queryKey: plannerKeys.settings,
    queryFn: () => api.get<PlannerSettingsDto>(`${P}/settings`),
  });
}

export function useUpdatePlannerSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (data: PlannerSettingsUpdate) =>
      api.patch<PlannerSettingsDto>(`${P}/settings`, data),
    onSuccess: (settings) => {
      client.setQueryData(plannerKeys.settings, settings);
      void client.invalidateQueries({ queryKey: plannerKeys.root });
    },
  });
}

export function useDashboardLayout() {
  return useQuery({
    queryKey: plannerKeys.layout,
    queryFn: () => api.get<DashboardLayout>(`${P}/layout`),
    staleTime: Infinity,
  });
}

/** The layout changes at once; a failed save puts the previous one back. */
export function useSaveDashboardLayout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (layout: DashboardLayout) => api.put<DashboardLayout>(`${P}/layout`, layout),
    onMutate: async (layout) => {
      // A refetch in flight would overwrite the optimistic layout with the old one.
      await client.cancelQueries({ queryKey: plannerKeys.layout });
      const previous = client.getQueryData<DashboardLayout>(plannerKeys.layout);
      client.setQueryData(plannerKeys.layout, layout);
      return previous;
    },
    onError: (error, _layout, previous) => {
      if (previous) client.setQueryData(plannerKeys.layout, previous);
      toast.error(errorMessage(error));
    },
    onSuccess: (layout) => client.setQueryData(plannerKeys.layout, layout),
  });
}

export function useMonthBudget(month: string) {
  return useQuery({
    queryKey: plannerKeys.month(month),
    queryFn: () => api.get<MonthBudgetDto>(`${P}/months/${month}`),
    placeholderData: keepPreviousData,
  });
}

export function useSetSavingsRate(month: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (savingsRate: string | null) =>
      api.put<MonthBudgetDto>(`${P}/months/${month}/savings-rate`, { savingsRate }),
    onSuccess: (budget) => {
      client.setQueryData(plannerKeys.month(month), budget);
      void client.invalidateQueries({ queryKey: plannerKeys.trends });
    },
  });
}

export function useTrend(to: string, months = 12) {
  return useQuery({
    queryKey: plannerKeys.trend(to, months),
    queryFn: () => api.get<PlannerTrendDto>(`${P}/trend`, { to, months }),
    placeholderData: keepPreviousData,
  });
}

// ---- incomes --------------------------------------------------------------------------------

export function useIncomes(month: string) {
  return useQuery({
    queryKey: plannerKeys.incomes(month),
    queryFn: () => api.get<IncomeLineDto[]>(`${P}/incomes`, { month }),
  });
}

type Stopped = { result: 'deleted' | 'ended' };

export function useIncomeMutations(month: string) {
  const client = useQueryClient();
  const saved = (line: IncomeLineDto) => {
    upsertRow(client, plannerKeys.incomes(month), line);
    reload();
  };
  // Other months show the same line (amount history, end month), so every month list refreshes.
  const reload = () => {
    void client.invalidateQueries({ queryKey: plannerKeys.incomesAll });
    refreshPlanTotals(client);
  };
  return {
    create: useMutation({
      mutationFn: (data: IncomeCreateInput) =>
        api.post<IncomeLineDto>(`${P}/incomes?month=${month}`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: IncomeUpdateInput }) =>
        api.patch<IncomeLineDto>(`${P}/incomes/${id}?month=${month}`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    setAmount: useMutation({
      mutationFn: ({ id, data }: { id: string; data: AmountChangeInput }) =>
        api.put<IncomeLineDto>(`${P}/incomes/${id}/amount`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    setSkipped: useMutation({
      mutationFn: ({ id, skipped }: { id: string; skipped: boolean }) =>
        api.put<IncomeLineDto>(`${P}/incomes/${id}/skip`, { month, skipped }),
      onSuccess: saved,
    }),
    stop: useMutation({
      mutationFn: (id: string) => api.post<Stopped>(`${P}/incomes/${id}/stop`, { month }),
      onSuccess: reload,
      meta: shownByCaller,
    }),
    addDeduction: useMutation({
      mutationFn: ({ incomeId, data }: { incomeId: string; data: DeductionCreateInput }) =>
        api.post<IncomeLineDto>(`${P}/incomes/${incomeId}/deductions?month=${month}`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    updateDeduction: useMutation({
      mutationFn: ({ id, data }: { id: string; data: DeductionUpdateInput }) =>
        api.patch<IncomeLineDto>(`${P}/deductions/${id}?month=${month}`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    deleteDeduction: useMutation({
      mutationFn: (id: string) => api.delete<IncomeLineDto>(`${P}/deductions/${id}?month=${month}`),
      onSuccess: saved,
      meta: shownByCaller,
    }),
  };
}

// ---- regular expenses ---------------------------------------------------------------------

export function useRecurring(month: string) {
  return useQuery({
    queryKey: plannerKeys.recurring(month),
    queryFn: () => api.get<RecurringLineDto[]>(`${P}/recurring`, { month }),
  });
}

export function useRecurringMutations(month: string) {
  const client = useQueryClient();
  const saved = (line: RecurringLineDto) => {
    upsertRow(client, plannerKeys.recurring(month), line);
    reload();
  };
  const reload = () => {
    void client.invalidateQueries({ queryKey: plannerKeys.recurringAll });
    refreshPlanTotals(client);
  };
  return {
    create: useMutation({
      mutationFn: (data: RecurringCreateInput) =>
        api.post<RecurringLineDto>(`${P}/recurring?month=${month}`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: RecurringUpdateInput }) =>
        api.patch<RecurringLineDto>(`${P}/recurring/${id}?month=${month}`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    setAmount: useMutation({
      mutationFn: ({ id, data }: { id: string; data: AmountChangeInput }) =>
        api.put<RecurringLineDto>(`${P}/recurring/${id}/amount`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    setSkipped: useMutation({
      mutationFn: ({ id, skipped }: { id: string; skipped: boolean }) =>
        api.put<RecurringLineDto>(`${P}/recurring/${id}/skip`, { month, skipped }),
      onSuccess: saved,
    }),
    /** «Оплачено»: an operation moves an account balance, a fund return refills its fund. */
    setPaid: useMutation({
      mutationFn: ({
        id,
        paid,
        actual = null,
      }: {
        id: string;
        paid: boolean;
        actual?: ActualPaymentInput | null;
      }) => api.put<RecurringLineDto>(`${P}/recurring/${id}/payment`, { month, paid, actual }),
      onSuccess: (line) => {
        upsertRow(client, plannerKeys.recurring(month), line);
        void invalidateMoney(client);
      },
      meta: shownByCaller,
    }),
    stop: useMutation({
      mutationFn: (id: string) => api.post<Stopped>(`${P}/recurring/${id}/stop`, { month }),
      onSuccess: reload,
      meta: shownByCaller,
    }),
  };
}

// ---- purchases ----------------------------------------------------------------------------

export function usePurchases() {
  return useQuery({
    queryKey: plannerKeys.purchases,
    queryFn: () => api.get<PurchaseDto[]>(`${P}/purchases`),
  });
}

export function usePurchaseHistory(id: string, enabled: boolean) {
  return useQuery({
    queryKey: plannerKeys.purchaseHistory(id),
    queryFn: () => api.get<PurchaseEventDto[]>(`${P}/purchases/${id}/history`),
    enabled,
  });
}

export type PurchaseStatusAction = 'unpurchase' | 'cancel' | 'restore';

export function usePurchaseMutations() {
  const client = useQueryClient();
  const put = (purchase: PurchaseDto) => {
    upsertRow(client, plannerKeys.purchases, purchase);
    void client.invalidateQueries({ queryKey: plannerKeys.purchaseHistory(purchase.id) });
  };
  const saved = (purchase: PurchaseDto) => {
    put(purchase);
    refreshPlanTotals(client);
  };
  /** Buying writes an operation off an account; undoing the purchase removes it. */
  const moneyMoved = (purchase: PurchaseDto) => {
    put(purchase);
    void invalidateMoney(client);
  };
  return {
    create: useMutation({
      mutationFn: (data: PurchaseCreateInput) => api.post<PurchaseDto>(`${P}/purchases`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    update: useMutation({
      mutationFn: ({ id, data }: { id: string; data: PurchaseUpdateInput }) =>
        api.patch<PurchaseDto>(`${P}/purchases/${id}`, data),
      onSuccess: saved,
      meta: shownByCaller,
    }),
    complete: useMutation({
      mutationFn: ({ id, data }: { id: string; data: PurchaseCompleteInput }) =>
        api.post<PurchaseDto>(`${P}/purchases/${id}/purchase`, data),
      onSuccess: moneyMoved,
      meta: shownByCaller,
    }),
    setStatus: useMutation({
      mutationFn: ({
        id,
        action,
        version,
      }: {
        id: string;
        action: PurchaseStatusAction;
        version: number;
      }) => api.post<PurchaseDto>(`${P}/purchases/${id}/${action}`, { version }),
      onSuccess: (purchase, { action }) =>
        action === 'unpurchase' ? moneyMoved(purchase) : saved(purchase),
      meta: shownByCaller,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.delete(`${P}/purchases/${id}`),
      onSuccess: (_result, id) => {
        removeRow<PurchaseDto>(client, plannerKeys.purchases, id);
        refreshPlanTotals(client);
      },
      meta: shownByCaller,
    }),
  };
}

export type PurchaseFilterStatus = PurchaseStatus | 'ALL';

// ---- exchange rates -------------------------------------------------------------------------

export function useRates() {
  return useQuery({
    queryKey: plannerKeys.rates,
    queryFn: () => api.get<RatesStatusDto>(`${P}/rates`),
  });
}

export function useRefreshRates() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RatesStatusDto>(`${P}/rates/refresh`),
    onSuccess: (status) => {
      client.setQueryData(plannerKeys.rates, status);
      // Lines in other currencies are converted again.
      refreshPlanTotals(client);
      void client.invalidateQueries({ queryKey: plannerKeys.incomesAll });
      void client.invalidateQueries({ queryKey: plannerKeys.recurringAll });
    },
  });
}

// ---- loans ----------------------------------------------------------------------------------

export function useLoans(month: string) {
  return useQuery({
    queryKey: plannerKeys.loans(month),
    queryFn: () => api.get<LoansDto>(`${P}/loans`, { month }),
  });
}
