import { useEffect, useState } from 'react';

function stored(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === '1';
  } catch {
    return fallback;
  }
}

/** A switch remembered in this browser (collapsed blocks, hidden totals). */
export function useStoredFlag(key: string, fallback: boolean) {
  const [value, setValue] = useState(() => stored(key, fallback));
  const toggle = () =>
    setValue((current) => {
      try {
        localStorage.setItem(key, current ? '0' : '1');
      } catch {
        // storage unavailable: the choice lasts until reload
      }
      return !current;
    });
  return [value, toggle] as const;
}

/** The current time, ticking every `intervalMs`. */
export function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}
