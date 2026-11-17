/** Both flags come from the authenticated server, never from a caller-selected workspace. */
export function isDemoSample(row: unknown): boolean {
  return Boolean(
    row && typeof row === 'object' && 'demoOrigin' in row && row.demoOrigin === 'sample',
  );
}
export function isDemoCreated(row: unknown): boolean {
  return Boolean(
    row && typeof row === 'object' && 'demoOrigin' in row && row.demoOrigin === 'created',
  );
}
