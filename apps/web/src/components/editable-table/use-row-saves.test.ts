import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRowSaves } from './use-row-saves';

describe('useRowSaves', () => {
  it('sends the second quick edit of a row with the version the first one returned', async () => {
    const { result } = renderHook(() => useRowSaves());
    const save = vi.fn((version: number) => Promise.resolve({ version: version + 1 }));
    const versionOf = (row: { version: number }) => row.version;
    // Both edits were made on the row as rendered with version 3.
    const first = result.current('row-1', 3, save, versionOf);
    const second = result.current('row-1', 3, save, versionOf);
    await Promise.all([first, second]);
    expect(save.mock.calls.map(([version]) => version)).toEqual([3, 4]);
  });

  it('keeps going after a failed save and lets other rows run independently', async () => {
    const { result } = renderHook(() => useRowSaves());
    const failing = vi.fn(() => Promise.reject(new Error('409')));
    const ok = vi.fn((version: number) => Promise.resolve({ version }));
    const versionOf = (row: { version: number }) => row.version;
    await expect(result.current('a', 1, failing, versionOf)).rejects.toThrow('409');
    await expect(result.current('a', 1, ok, versionOf)).resolves.toEqual({ version: 1 });
    await expect(result.current('b', 7, ok, versionOf)).resolves.toEqual({ version: 7 });
  });
});
