import { describe, it, expect, beforeEach } from 'vitest';
import type { ColumnarResult } from '../../lib/types';
import { useResultStore } from '../resultStore';

function columnar(queryId: string): ColumnarResult {
  return {
    query_id: queryId,
    columns: [
      { name: 'id', data_type: 'Integer', native_type: 'int4', nullable: false, is_primary_key: true, max_length: null },
    ],
    data: [{ kind: 'Integers', values: [1] }],
    row_count: 1,
    affected_rows: null,
    execution_time_ms: 1,
    warnings: [],
    result_type: 'Select',
  };
}

describe('getActiveResult identity', () => {
  beforeEach(() => {
    useResultStore.setState({ results: {} });
  });

  it('returns the same object across calls when nothing changed', () => {
    useResultStore.getState().setColumnarResult('tab1', columnar('q1'));
    const a = useResultStore.getState().getActiveResult('tab1');
    const b = useResultStore.getState().getActiveResult('tab1');
    expect(a).not.toBeNull();
    expect(b).toBe(a); // identity, not equality
  });

  it('returns a fresh object after setActiveResultIndex', () => {
    useResultStore.getState().setColumnarResults('tab1', [columnar('q1'), columnar('q2')], null);
    const a = useResultStore.getState().getActiveResult('tab1');
    useResultStore.getState().setActiveResultIndex('tab1', 1);
    const b = useResultStore.getState().getActiveResult('tab1');
    expect(b).not.toBe(a);
    expect(b?.query_id).toBe('q2');
  });

  it('returns a fresh object after a new result replaces the old one', () => {
    useResultStore.getState().setColumnarResult('tab1', columnar('q1'));
    const a = useResultStore.getState().getActiveResult('tab1');
    useResultStore.getState().setColumnarResult('tab1', columnar('q2'));
    const b = useResultStore.getState().getActiveResult('tab1');
    expect(b).not.toBe(a);
    expect(b?.query_id).toBe('q2');
  });

  it('still returns null for unknown tab / missing columnar', () => {
    expect(useResultStore.getState().getActiveResult('nope')).toBeNull();
  });
});
