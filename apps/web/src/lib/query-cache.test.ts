import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { removeRow, upsertRow, upsertRows } from './query-cache';

type Row = { id: string; version: number };

describe('query cache rows', () => {
  it('replaces a row in place, appends a new one and removes one', () => {
    const client = new QueryClient();
    const key = ['rows'];
    client.setQueryData<Row[]>(key, [
      { id: 'a', version: 1 },
      { id: 'b', version: 1 },
    ]);
    upsertRow(client, key, { id: 'a', version: 2 });
    upsertRow(client, key, { id: 'c', version: 1 });
    expect(client.getQueryData(key)).toEqual([
      { id: 'a', version: 2 },
      { id: 'b', version: 1 },
      { id: 'c', version: 1 },
    ]);
    removeRow<Row>(client, key, 'b');
    expect(client.getQueryData<Row[]>(key)?.map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('merges returned rows by id and keeps the rows the answer lacks', () => {
    const client = new QueryClient();
    const key = ['rows'];
    // A demo list: a masked sample and the user's own row; a demo write returns only own rows.
    client.setQueryData<Row[]>(key, [
      { id: 'sample', version: 1 },
      { id: 'own', version: 1 },
    ]);
    upsertRows(client, key, [
      { id: 'own', version: 2 },
      { id: 'new', version: 1 },
    ]);
    expect(client.getQueryData(key)).toEqual([
      { id: 'sample', version: 1 },
      { id: 'own', version: 2 },
      { id: 'new', version: 1 },
    ]);
    upsertRows(client, ['missing'], [{ id: 'a', version: 1 }]);
    expect(client.getQueryData(['missing'])).toBeUndefined();
  });

  it('leaves a list that is not cached alone', () => {
    const client = new QueryClient();
    upsertRow(client, ['missing'], { id: 'a' });
    expect(client.getQueryData(['missing'])).toBeUndefined();
  });
});
