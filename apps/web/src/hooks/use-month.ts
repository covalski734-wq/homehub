import { currentMonth, isValidMonth, shiftMonth } from '@homehub/shared';
import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';

const STORAGE_KEY = 'homehub.month';

function storedMonth(): string | null {
  try {
    const value = sessionStorage.getItem(STORAGE_KEY);
    return value && isValidMonth(value) ? value : null;
  } catch {
    return null;
  }
}

function storeMonth(month: string) {
  try {
    if (month === currentMonth()) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, month);
  } catch {
    // storage unavailable: the month lives only in the URL
  }
}

/**
 * The selected month lives in the URL (?month=YYYY-MM): it survives reloads and works with
 * back/forward. A link without the month (menu, a dialog link) keeps the month chosen in this tab
 * instead of jumping back to the current one.
 */
export function useMonth() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('month');
  const fromUrl = raw && isValidMonth(raw) ? raw : null;
  const month = fromUrl ?? storedMonth() ?? currentMonth();

  useEffect(() => {
    if (fromUrl) storeMonth(fromUrl);
  }, [fromUrl]);

  const setMonth = useCallback(
    (next: string) => {
      storeMonth(next);
      setParams(
        (prev) => {
          const updated = new URLSearchParams(prev);
          if (next === currentMonth()) updated.delete('month');
          else updated.set('month', next);
          updated.delete('page');
          return updated;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return {
    month,
    setMonth,
    previous: () => setMonth(shiftMonth(month, -1)),
    next: () => setMonth(shiftMonth(month, 1)),
    isCurrent: month === currentMonth(),
  };
}
