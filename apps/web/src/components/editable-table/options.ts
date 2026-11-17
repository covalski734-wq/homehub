import { z } from 'zod';

/**
 * Select options of a shared enum (`PLANNER_CURRENCIES`, `SERVICE_TYPES`…) with their labels.
 * Build the column with this and read the cell back with `optionValue` over the same list.
 */
export function enumOptions<T extends string>(
  values: readonly T[],
  label: (value: T) => string = (value) => value,
) {
  return values.map((value) => ({ value, label: label(value) }));
}

/**
 * A select cell's text as the enum value its options were built from. The cell hands back a
 * string; the shared `z.enum` checks it instead of a cast, so a stale or foreign value fails the
 * save (the table shows the error) rather than reaching the server mistyped.
 */
export function optionValue<const T extends readonly [string, ...string[]]>(
  values: T,
  text: string,
): T[number] {
  return z.enum(values).parse(text);
}
