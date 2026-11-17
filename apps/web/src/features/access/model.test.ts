import { describe, expect, it } from 'vitest';
import { normalizeScopes, scopeSummary, toggleScope } from './model';

describe('toggleScope', () => {
  it('checking write checks read too', () => {
    expect(toggleScope([], 'finance', 'write', true)).toEqual(['finance:read', 'finance:write']);
  });

  it('checking read leaves write alone', () => {
    expect(toggleScope([], 'savings', 'read', true)).toEqual(['savings:read']);
  });

  it('unchecking read unchecks write', () => {
    expect(toggleScope(['finance:read', 'finance:write'], 'finance', 'read', false)).toEqual([]);
  });

  it('unchecking write keeps read', () => {
    expect(toggleScope(['finance:read', 'finance:write'], 'finance', 'write', false)).toEqual([
      'finance:read',
    ]);
  });

  it('touches only its own area and keeps the catalog order without repeats', () => {
    expect(toggleScope(['household:read', 'planner:read'], 'finance', 'write', true)).toEqual([
      'finance:read',
      'finance:write',
      'planner:read',
      'household:read',
    ]);
    expect(toggleScope(['savings:read'], 'savings', 'read', true)).toEqual(['savings:read']);
  });
});

describe('normalizeScopes', () => {
  it('adds read to every requested write', () => {
    expect(normalizeScopes(['savings:write', 'finance:read'])).toEqual([
      'finance:read',
      'savings:read',
      'savings:write',
    ]);
  });

  it('keeps an empty request empty', () => {
    expect(normalizeScopes([])).toEqual([]);
  });
});

describe('scopeSummary', () => {
  it('groups scopes by area in the settings order', () => {
    expect(
      scopeSummary(['household:read', 'finance:write', 'finance:read', 'savings:write']),
    ).toEqual([
      { area: 'finance', access: 'readWrite' },
      { area: 'savings', access: 'write' },
      { area: 'household', access: 'read' },
    ]);
  });
});
