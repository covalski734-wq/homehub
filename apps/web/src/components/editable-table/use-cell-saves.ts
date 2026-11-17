import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import type { CellStatus } from './types';

/**
 * Save state of every cell, keyed `<row id>:<column key>`: a spinner while saving, a check that
 * fades out after success, an error that stays until the next save of that cell.
 */
export function useCellSaves() {
  const [statuses, setStatuses] = useState<Record<string, CellStatus>>({});

  const setStatus = useCallback((key: string, status: CellStatus | null) => {
    setStatuses((prev) => {
      const next = { ...prev };
      if (status) next[key] = status;
      else delete next[key];
      return next;
    });
  }, []);

  const run = async (key: string, save: () => Promise<unknown>) => {
    setStatus(key, { state: 'saving' });
    try {
      await save();
      setStatus(key, { state: 'saved' });
      setTimeout(
        () =>
          setStatuses((prev) =>
            prev[key]?.state === 'saved' ? (({ [key]: _removed, ...rest }) => rest)(prev) : prev,
          ),
        2200,
      );
    } catch (error) {
      setStatus(key, { state: 'error', message: errorMessage(error) });
      toast.error(errorMessage(error));
    }
  };

  /** The most important status among a row's cells: an error, then saving, then saved. */
  const rowStatus = (rowId: string): CellStatus | undefined => {
    const prefix = `${rowId}:`;
    const list = Object.entries(statuses)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, s]) => s);
    return (
      list.find((s) => s.state === 'error') ?? list.find((s) => s.state === 'saving') ?? list[0]
    );
  };

  const all = Object.values(statuses);
  return {
    statuses,
    run,
    rowStatus,
    saving: all.some((s) => s.state === 'saving'),
    failed: all.some((s) => s.state === 'error'),
  };
}
