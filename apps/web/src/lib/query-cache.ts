import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Puts a row returned by the server into a cached list (it carries the new `version`), so the
 * next edit of the same row is sent with that version even before the list is refetched.
 * A list that is not cached yet is left alone: it loads fresh anyway.
 */
export function upsertRow<T extends { id: string }>(client: QueryClient, key: QueryKey, row: T) {
  client.setQueryData<T[]>(key, (rows) => {
    if (!rows) return rows;
    const index = rows.findIndex((r) => r.id === row.id);
    return index === -1 ? [...rows, row] : rows.map((r) => (r.id === row.id ? row : r));
  });
}

/**
 * Puts several returned rows into a cached list by id; rows the answer does not carry stay. A
 * demo-mode write answers with the user's own rows only, so replacing the list would drop the
 * masked samples it is merged with.
 */
export function upsertRows<T extends { id: string }>(
  client: QueryClient,
  key: QueryKey,
  fresh: readonly T[],
) {
  client.setQueryData<T[]>(key, (rows) => {
    if (!rows) return rows;
    const byId = new Map(fresh.map((r) => [r.id, r]));
    const known = new Set(rows.map((r) => r.id));
    return [...rows.map((r) => byId.get(r.id) ?? r), ...fresh.filter((r) => !known.has(r.id))];
  });
}

/** Drops a deleted row from a cached list. */
export function removeRow<T extends { id: string }>(
  client: QueryClient,
  key: QueryKey,
  id: string,
) {
  client.setQueryData<T[]>(key, (rows) => rows?.filter((r) => r.id !== id));
}
