/**
 * Preconditions inside a `d1.batch`. D1 has no interactive transactions: reading a balance, then
 * writing in a separate call lets another request change the balance in between. A guard puts the
 * check into the batch itself — the batch is one transaction, and a false condition aborts all of
 * it (migration 0023: the `batch_guard` view raises HH_GUARD_FAILED).
 *
 * The condition is SQL with anonymous `?` placeholders.
 */
export function guard(
  d1: D1Database,
  condition: string,
  ...params: unknown[]
): D1PreparedStatement {
  return d1
    .prepare(`INSERT INTO batch_guard (ok) SELECT CASE WHEN ${condition} THEN 1 ELSE 0 END`)
    .bind(...params);
}

/** The batch was aborted by a guard (and changed nothing). */
export function isGuardFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (current instanceof Error) {
      if (current.message.includes('HH_GUARD_FAILED')) return true;
      current = current.cause;
    } else return String(current).includes('HH_GUARD_FAILED');
  }
  return false;
}

/** Runs the batch; a failed guard becomes `onGuard()` (usually a specific HTTP error). */
export async function guardedBatch(
  d1: D1Database,
  statements: D1PreparedStatement[],
  onGuard: () => Error | Promise<Error>,
): Promise<D1Result[]> {
  try {
    return await d1.batch(statements);
  } catch (error) {
    if (isGuardFailure(error)) throw await onGuard();
    throw error;
  }
}
