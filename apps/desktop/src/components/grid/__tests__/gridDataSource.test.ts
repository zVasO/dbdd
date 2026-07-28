import { describe, it, expect } from 'vitest';
import { resolveColumnarSource } from '../gridDataSource';
import type { ColumnData } from '@/lib/types';

const explicit: ColumnData[] = [{ kind: 'Strings', values: ['explicit'] }];
const store: ColumnData[] = [{ kind: 'Strings', values: ['store'] }];

describe('resolveColumnarSource', () => {
  it('uses the explicit data prop over the active tab store, even when both are present', () => {
    const result = resolveColumnarSource(explicit, 1, store, 99, 5);
    expect(result.data).toBe(explicit);
    expect(result.rowCount).toBe(1);
  });

  it('falls back to the store data when no explicit data is provided', () => {
    const result = resolveColumnarSource(undefined, undefined, store, 99, 5);
    expect(result.data).toBe(store);
    expect(result.rowCount).toBe(99);
  });

  it('derives rowCount from the fallback when neither explicit nor store rowCount is given', () => {
    const result = resolveColumnarSource(explicit, undefined, undefined, undefined, 5);
    expect(result.rowCount).toBe(5);
  });

  it('returns the same empty-array reference when there is no data at all, preserving memoization', () => {
    const first = resolveColumnarSource(undefined, undefined, undefined, undefined, 0);
    const second = resolveColumnarSource(undefined, undefined, undefined, undefined, 0);
    expect(first.data).toBe(second.data);
    expect(first.data).toEqual([]);
  });
});
