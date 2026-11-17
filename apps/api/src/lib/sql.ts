type SqlValue = string | number | null;

/**
 * The SET clause of a partial update: only columns whose value is given (not undefined) change,
 * so two people editing different fields of one row both keep their change. Column names come
 * from code, values are always bound.
 */
export function partialSet(columns: Record<string, SqlValue | undefined>): {
  sql: string;
  params: SqlValue[];
} {
  const given = Object.entries(columns).filter(
    (entry): entry is [string, SqlValue] => entry[1] !== undefined,
  );
  return {
    sql: given.map(([column]) => `${column} = ?`).join(', '),
    params: given.map(([, value]) => value),
  };
}

/** A timestamp for an archive flag: now, null to restore, undefined to keep. */
export const archivedAt = (archived: boolean | undefined, now = Date.now()) =>
  archived === undefined ? undefined : archived ? now : null;
