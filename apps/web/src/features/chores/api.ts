import {
  todayDate,
  type ChoreCompletionDto,
  type ChoreCreateInput,
  type ChoreDto,
  type ChoresOverviewDto,
  type ChoreUpdateInput,
} from '@homehub/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { roots } from '@/lib/query-keys';

export const choreKeys = {
  root: roots.chores,
  overview: [...roots.chores, 'overview'] as const,
};

/** The member's local date: due dates and «done on» are household days, not UTC days. */
export const localToday = () => todayDate();

export function useChores() {
  return useQuery({
    queryKey: choreKeys.overview,
    queryFn: () => api.get<ChoresOverviewDto>('/chores', { today: localToday() }),
  });
}

function patch(client: QueryClient, update: (data: ChoresOverviewDto) => ChoresOverviewDto) {
  client.setQueryData<ChoresOverviewDto>(choreKeys.overview, (data) =>
    data ? update(data) : data,
  );
}

const putChore = (data: ChoresOverviewDto, chore: ChoreDto): ChoresOverviewDto => ({
  ...data,
  chores: data.chores.some((c) => c.id === chore.id)
    ? data.chores.map((c) => (c.id === chore.id ? chore : c))
    : [...data.chores, chore],
});

/**
 * Every change puts the server's answer into the cached overview. A failure shows the default
 * toast and refetches the overview: the chore may have been changed by the other member (409).
 */
function useChoreMutation<T, R>(
  request: (input: T) => Promise<R>,
  apply: (data: ChoresOverviewDto, result: R, input: T) => ChoresOverviewDto,
  options: { silent?: boolean } = {},
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (result, input) => patch(client, (data) => apply(data, result, input)),
    onSettled: (_result, error) => {
      if (error) void client.invalidateQueries({ queryKey: choreKeys.root });
    },
    meta: options.silent ? { silent: true } : undefined,
  });
}

export const useCreateChore = () =>
  useChoreMutation((input: ChoreCreateInput) => api.post<ChoreDto>('/chores', input), putChore);

/** The chore form: a failure is shown in the form, not as a toast. */
export const useSaveChore = () =>
  useChoreMutation(
    ({ id, input }: { id?: string; input: ChoreCreateInput | ChoreUpdateInput }) =>
      id ? api.patch<ChoreDto>(`/chores/${id}`, input) : api.post<ChoreDto>('/chores', input),
    putChore,
    { silent: true },
  );

/** The starter set: created one by one, so the first due dates keep their order. */
export const useCreateChores = () =>
  useChoreMutation(
    async (inputs: ChoreCreateInput[]) => {
      const created: ChoreDto[] = [];
      for (const input of inputs) created.push(await api.post<ChoreDto>('/chores', input));
      return created;
    },
    (data, created) => created.reduce(putChore, data),
  );

export const useDeleteChore = () =>
  useChoreMutation(
    (id: string) => api.delete(`/chores/${id}`),
    (data, _result, id) => ({
      ...data,
      chores: data.chores.filter((c) => c.id !== id),
      completions: data.completions.filter((c) => c.choreId !== id),
    }),
  );

export const useCompleteChore = () =>
  useChoreMutation(
    (chore: ChoreDto) =>
      api.post<{ chore: ChoreDto; completion: ChoreCompletionDto }>(
        `/chores/${chore.id}/complete`,
        { doneOn: localToday(), version: chore.version },
      ),
    (data, result) => ({
      ...putChore(data, result.chore),
      completions: [result.completion, ...data.completions],
    }),
  );

export const useSnoozeChore = () =>
  useChoreMutation(
    ({ chore, days }: { chore: ChoreDto; days: number }) =>
      api.post<ChoreDto>(`/chores/${chore.id}/snooze?today=${localToday()}`, {
        days,
        version: chore.version,
      }),
    putChore,
  );

export const useUndoCompletion = () =>
  useChoreMutation(
    (completionId: string) => api.delete<ChoreDto>(`/chores/completions/${completionId}`),
    (data, chore, completionId) => ({
      ...putChore(data, chore),
      completions: data.completions.filter((c) => c.id !== completionId),
    }),
  );
