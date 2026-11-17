import { useCallback, useRef } from 'react';

/**
 * Saves of cells in the same row run one after another, each with the newest version the server
 * returned. Without this, typing in one cell and tabbing to the next would send the second save
 * with the version the row had before the first save, and get a false 409 conflict.
 * A conflict caused by another user still comes back as 409.
 */
export function useRowSaves() {
  const queues = useRef(new Map<string, Promise<unknown>>());
  const versions = useRef(new Map<string, number>());

  return useCallback(
    <T>(
      rowKey: string,
      renderedVersion: number,
      save: (version: number) => Promise<T>,
      versionOf: (result: T) => number,
    ): Promise<T> => {
      const previous = queues.current.get(rowKey) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          const version = Math.max(versions.current.get(rowKey) ?? 0, renderedVersion);
          const result = await save(version);
          versions.current.set(rowKey, versionOf(result));
          return result;
        });
      queues.current.set(rowKey, next);
      return next;
    },
    [],
  );
}
