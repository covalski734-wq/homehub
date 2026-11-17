import { useMemo, useState } from 'react';
import { LOCALE_SHORT } from '@/i18n';
import type { Column } from './types';

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

/** Rows after the search box and the column sort (asc → desc → original order). */
export function useVisibleRows<Row, Extra extends string>(
  rows: Row[],
  columns: Column<Row, Extra>[],
  searchText: ((row: Row) => string) | undefined,
) {
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState('');

  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    let list =
      query && searchText
        ? rows.filter((row) => searchText(row).toLowerCase().includes(query))
        : rows;
    const column = sort && columns.find((c) => c.key === sort.key);
    if (sort && column?.sortValue) {
      const get = column.sortValue;
      list = [...list].sort((a, b) => {
        const left = get(a);
        const right = get(b);
        const order =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right), LOCALE_SHORT);
        return sort.dir === 'asc' ? order : -order;
      });
    }
    return list;
  }, [rows, search, searchText, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((current) =>
      current?.key !== key
        ? { key, dir: 'asc' }
        : current.dir === 'asc'
          ? { key, dir: 'desc' }
          : null,
    );

  return { visibleRows, sort, toggleSort, search, setSearch };
}
