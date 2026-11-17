import { useRef, useState, type RefObject } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';
import { t } from '@/i18n';
import type { Column, Draft, DraftConfig } from './types';

/**
 * New rows added with «+»: each is a local draft until its required cells are filled, then it is
 * created once (on Enter or when focus leaves the draft).
 */
export function useDrafts<Row, Extra extends string, DraftKey extends string>(
  draft: DraftConfig<DraftKey> | undefined,
  columns: Column<Row, Extra>[],
  tableRef: RefObject<HTMLElement | null>,
) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  /**
   * Drafts being created right now. Enter and the blur it causes fire in the same tick, before
   * `drafts` re-renders with the saving status, so the guard must not depend on state.
   */
  const creating = useRef(new Set<string>());

  const add = () => {
    if (!draft) return;
    const tempId = `draft-${crypto.randomUUID()}`;
    setDrafts((prev) => [...prev, { tempId, values: { ...draft.defaults }, errors: {} }]);
    requestAnimationFrame(() => {
      tableRef.current
        ?.querySelector<HTMLElement>(
          `[data-draft="${tempId}"] input, [data-draft="${tempId}"] select`,
        )
        ?.focus();
    });
  };

  const update = (tempId: string, key: string, value: string) =>
    setDrafts((prev) =>
      prev.map((d) =>
        d.tempId === tempId
          ? { ...d, values: { ...d.values, [key]: value }, errors: { ...d.errors, [key]: '' } }
          : d,
      ),
    );

  const cancel = (tempId: string) => setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));

  const submit = async (tempId: string) => {
    if (!draft) return;
    const current = drafts.find((d) => d.tempId === tempId);
    if (!current || creating.current.has(tempId)) return;
    const errors: Record<string, string> = {};
    for (const key of draft.required)
      if (!current.values[key]?.trim()) errors[key] = t('table.validation.required');
    for (const column of columns) {
      const value = current.values[column.key];
      if (value !== undefined && value !== '' && column.validate) {
        const problem = column.validate(value, null);
        if (problem) errors[column.key] = problem;
      }
    }
    if (Object.keys(errors).length > 0) {
      setDrafts((prev) => prev.map((d) => (d.tempId === tempId ? { ...d, errors } : d)));
      return;
    }
    setDrafts((prev) =>
      prev.map((d) => (d.tempId === tempId ? { ...d, status: { state: 'saving' } } : d)),
    );
    creating.current.add(tempId);
    try {
      // Starts as a copy of `defaults`, so every key of DraftKey is present.
      await draft.create({ ...draft.defaults, ...current.values });
      setDrafts((prev) => prev.filter((d) => d.tempId !== tempId));
    } catch (error) {
      creating.current.delete(tempId);
      setDrafts((prev) =>
        prev.map((d) =>
          d.tempId === tempId
            ? { ...d, status: { state: 'error', message: errorMessage(error) } }
            : d,
        ),
      );
      toast.error(errorMessage(error));
    }
  };

  return {
    drafts,
    add,
    update,
    cancel,
    submit,
    saving: drafts.some((d) => d.status?.state === 'saving'),
  };
}
