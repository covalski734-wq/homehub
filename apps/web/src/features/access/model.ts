import { READ_ONLY_AREAS, SCOPE_AREAS, SCOPES, type Scope, type ScopeArea } from '@homehub/shared';

export type ScopeLevel = 'read' | 'write';

const KNOWN: ReadonlySet<string> = new Set(SCOPES);
const isScope = (value: string): value is Scope => KNOWN.has(value);

/** The scope of an area's level; null where the area has no such level (conversations: no write). */
export function scopeOf(area: ScopeArea, level: ScopeLevel): Scope | null {
  const scope = `${area}:${level}`;
  return isScope(scope) ? scope : null;
}

/** The grid's columns an area has: read-only areas have no «изменение». */
export const levelsOf = (area: ScopeArea): ScopeLevel[] =>
  READ_ONLY_AREAS.has(area) ? ['read'] : ['read', 'write'];

/** Scopes in the catalog order, without repeats: lists and requests compare equal. */
const ordered = (scopes: Iterable<Scope>): Scope[] => {
  const set = new Set(scopes);
  return SCOPES.filter((scope) => set.has(scope));
};

const has = (set: ReadonlySet<Scope>, scope: Scope | null) => scope !== null && set.has(scope);

/**
 * One checkbox of the area × (read, write) grid. Changing data without seeing it makes no sense,
 * so write implies read: checking write checks read, unchecking read unchecks write.
 */
export function toggleScope(
  scopes: readonly Scope[],
  area: ScopeArea,
  level: ScopeLevel,
  checked: boolean,
): Scope[] {
  const next = new Set(scopes);
  const scope = scopeOf(area, level);
  const read = scopeOf(area, 'read');
  const write = scopeOf(area, 'write');
  if (scope === null) return ordered(next);
  if (checked) {
    next.add(scope);
    if (level === 'write' && read) next.add(read);
  } else {
    next.delete(scope);
    if (level === 'read' && write) next.delete(write);
  }
  return ordered(next);
}

/** Requested scopes as the grid shows them: a requested write brings its read along. */
export function normalizeScopes(scopes: readonly Scope[]): Scope[] {
  const set = new Set(scopes);
  return ordered(
    SCOPE_AREAS.flatMap((area): Scope[] => {
      const read = scopeOf(area, 'read');
      const write = scopeOf(area, 'write');
      const wanted = has(set, write) || has(set, read);
      if (!wanted) return [];
      return [read, has(set, write) ? write : null].filter((s): s is Scope => s !== null);
    }),
  );
}

/** What a connection may do in an area: only read, only write (old data) or both. */
export type AreaAccess = 'read' | 'write' | 'readWrite';

/** Granted scopes grouped by area, in the settings order, for «Финансы: чтение и изменение». */
export function scopeSummary(scopes: readonly Scope[]): { area: ScopeArea; access: AreaAccess }[] {
  const set = new Set(scopes);
  return SCOPE_AREAS.flatMap((area) => {
    const read = has(set, scopeOf(area, 'read'));
    const write = has(set, scopeOf(area, 'write'));
    if (!read && !write) return [];
    return [{ area, access: read && write ? 'readWrite' : read ? 'read' : 'write' }];
  });
}
