import type { ShoppingAddInput, ShoppingListDto } from '@homehub/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';
import { roots } from '@/lib/query-keys';

export const shoppingKeys = {
  root: roots.shopping,
  list: [...roots.shopping, 'list'] as const,
};

export function useShoppingList() {
  return useQuery({
    queryKey: shoppingKeys.list,
    queryFn: () => api.get<ShoppingListDto>('/shopping'),
    // The other member may be ticking things off in the store right now.
    refetchInterval: 8000,
  });
}

/** Adding and clearing return the whole list; a failure refetches it (default toast). */
function useListMutation<T>(request: (input: T) => Promise<ShoppingListDto>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (list) => client.setQueryData(shoppingKeys.list, list),
    onSettled: (_list, error) => {
      if (error) void client.invalidateQueries({ queryKey: shoppingKeys.root });
    },
  });
}

export const useAddShoppingItems = () =>
  useListMutation((items: ShoppingAddInput['items']) =>
    api.post<ShoppingListDto>('/shopping', { items }),
  );

export const useClearShoppingCart = () =>
  useListMutation(() => api.post<ShoppingListDto>('/shopping/clear'));

/**
 * A tick or a removal shows at once. The list is polled every 8 s, so a refetch in flight is
 * cancelled first (it would bring the item back); a failure restores the list and refetches it.
 */
function useOptimisticItem<T extends { id: string }>(
  request: (input: T) => Promise<unknown>,
  update: (data: ShoppingListDto, input: T) => ShoppingListDto,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: request,
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: shoppingKeys.root });
      const previous = client.getQueryData<ShoppingListDto>(shoppingKeys.list);
      if (previous) client.setQueryData(shoppingKeys.list, update(previous, input));
      return previous;
    },
    onError: (error, _input, previous) => {
      if (previous) client.setQueryData(shoppingKeys.list, previous);
      toast.error(errorMessage(error));
      void client.invalidateQueries({ queryKey: shoppingKeys.root });
    },
  });
}

export const useToggleShoppingItem = () =>
  useOptimisticItem(
    ({ id, checked }: { id: string; checked: boolean }) =>
      api.patch(`/shopping/${id}`, { checked }),
    (data, { id, checked }) => ({
      ...data,
      items: data.items.map((i) => (i.id === id ? { ...i, checked } : i)),
    }),
  );

export const useRemoveShoppingItem = () =>
  useOptimisticItem(
    ({ id }: { id: string }) => api.delete(`/shopping/${id}`),
    (data, { id }) => ({ ...data, items: data.items.filter((i) => i.id !== id) }),
  );
