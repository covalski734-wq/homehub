import {
  TRANSACTION_SORT_FIELDS,
  TRANSACTION_TYPES,
  type TransactionQueryInput,
  type TransactionSortField,
  type TransactionType,
} from '@homehub/shared';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { useMonth } from '@/hooks/use-month';

export const PAGE_SIZE = 25;

export interface TransactionFilters {
  type: TransactionType | '';
  accountId: string;
  categoryId: string;
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((item) => item === value);
}

/** Filters, sorting and page are kept in the URL so the view survives reloads and can be bookmarked. */
export function useTransactionFilters() {
  const { month } = useMonth();
  const [params, setParams] = useSearchParams();

  const filters: TransactionFilters = {
    type: oneOf(params.get('type'), TRANSACTION_TYPES) ?? '',
    accountId: params.get('account') ?? '',
    categoryId: params.get('category') ?? '',
  };
  const sortBy: TransactionSortField =
    oneOf(params.get('sort'), TRANSACTION_SORT_FIELDS) ?? 'occurredAt';
  const sortDir: 'asc' | 'desc' = params.get('dir') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const update = useCallback(
    (changes: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') next.delete(key);
            else next.set(key, String(value));
          }
          if (resetPage) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const query: TransactionQueryInput = {
    month,
    type: filters.type || undefined,
    accountId: filters.accountId || undefined,
    categoryId: filters.categoryId || undefined,
    page,
    pageSize: PAGE_SIZE,
    sortBy,
    sortDir,
  };

  return {
    month,
    filters,
    sortBy,
    sortDir,
    page,
    query,
    hasFilters: Boolean(filters.type || filters.accountId || filters.categoryId),
    setFilter: (key: keyof TransactionFilters, value: string) =>
      update({
        [key === 'accountId' ? 'account' : key === 'categoryId' ? 'category' : 'type']: value,
      }),
    clearFilters: () => update({ type: null, account: null, category: null }),
    setSort: (field: TransactionSortField, dir: 'asc' | 'desc') => update({ sort: field, dir }),
    setPage: (next: number) => update({ page: next > 1 ? next : null }, false),
  };
}
