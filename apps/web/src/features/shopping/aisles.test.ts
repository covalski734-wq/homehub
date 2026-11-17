import { describe, expect, it } from 'vitest';
import { aisleOf } from './aisles';

describe('aisleOf', () => {
  it('puts items into store sections by the most specific keyword', () => {
    expect(aisleOf('Молоко 3,2%')).toBe('dairy');
    expect(aisleOf('Зубная паста')).toBe('care');
    expect(aisleOf('Паста карбонара')).toBe('grocery');
    expect(aisleOf('Масло сливочное')).toBe('dairy');
    expect(aisleOf('Помидоры черри')).toBe('produce');
    expect(aisleOf('Корм для кошки')).toBe('pets');
    expect(aisleOf('Подарок маме')).toBe('other');
  });
});
