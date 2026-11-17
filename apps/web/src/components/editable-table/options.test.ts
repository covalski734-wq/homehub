import { describe, expect, it } from 'vitest';
import { enumOptions, optionValue } from './options';

const SIZES = ['S', 'M', 'L'] as const;

describe('select options', () => {
  it('builds options from an enum in its order', () => {
    expect(enumOptions(SIZES)).toEqual([
      { value: 'S', label: 'S' },
      { value: 'M', label: 'M' },
      { value: 'L', label: 'L' },
    ]);
    expect(enumOptions(SIZES, (s) => s.toLowerCase())[1]).toEqual({ value: 'M', label: 'm' });
  });

  it('reads a cell back as the enum value and rejects anything else', () => {
    expect(optionValue(SIZES, 'M')).toBe('M');
    expect(() => optionValue(SIZES, 'XL')).toThrow();
    expect(() => optionValue(SIZES, '')).toThrow();
  });
});
