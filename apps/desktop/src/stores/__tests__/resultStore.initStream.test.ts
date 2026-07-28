import { beforeEach, describe, expect, it } from 'vitest';
import type { ColumnMeta, StreamMeta } from '../../lib/types';
import { useResultStore } from '../resultStore';

function column(data_type: ColumnMeta['data_type']): ColumnMeta {
  return {
    name: 'col',
    data_type,
    native_type: 'unused',
    nullable: true,
    is_primary_key: false,
    max_length: null,
  };
}

function meta(columns: ColumnMeta[], column_kinds?: StreamMeta['column_kinds']): StreamMeta {
  return {
    query_id: 'q1',
    columns,
    column_kinds,
    result_type: 'Select',
    warnings: [],
  };
}

describe('resultStore.initStream kind derivation', () => {
  beforeEach(() => {
    useResultStore.setState({ results: {} });
  });

  it('adopts meta.column_kinds directly when present, without consulting data_type', () => {
    // data_type here would map to Booleans by name — column_kinds must win,
    // proving the frontend defers to the backend's computed kind.
    useResultStore.getState().initStream('t1', meta([column('Boolean')], ['Strings']));

    expect(useResultStore.getState().results.t1.data).toEqual([{ kind: 'Strings', values: [] }]);
  });

  it.each([
    ['Integer', 'Integers'],
    ['SmallInt', 'Integers'],
    ['BigInt', 'Integers'],
    ['Serial', 'Integers'],
    ['Float', 'Floats'],
    ['Double', 'Floats'],
    ['Boolean', 'Booleans'],
    ['Json', 'Json'],
    ['Jsonb', 'Json'],
    ['Text', 'Strings'],
    ['Uuid', 'Strings'],
  ] as const)('falls back to deriving %s -> %s from data_type when column_kinds is absent', (dataType, expectedKind) => {
    useResultStore.getState().initStream('t1', meta([column(dataType)]));

    expect(useResultStore.getState().results.t1.data).toEqual([{ kind: expectedKind, values: [] }]);
  });

  it('falls back Decimal (a struct-variant data_type, sent as an object) to Strings, not Floats', () => {
    // Matches Rust: Postgres/MySQL decimals decode to CellValue::Text to avoid
    // precision loss, so bucketing them as floats would null every value.
    useResultStore.getState().initStream(
      't1',
      meta([column({ Decimal: { precision: 10, scale: 2 } })]),
    );

    expect(useResultStore.getState().results.t1.data).toEqual([{ kind: 'Strings', values: [] }]);
  });

  it('derives one kind per column, independently, when column_kinds is absent', () => {
    useResultStore.getState().initStream(
      't1',
      meta([column('Integer'), column('Float'), column('Boolean'), column({ Decimal: {} }), column('Text')]),
    );

    expect(useResultStore.getState().results.t1.data).toEqual([
      { kind: 'Integers', values: [] },
      { kind: 'Floats', values: [] },
      { kind: 'Booleans', values: [] },
      { kind: 'Strings', values: [] },
      { kind: 'Strings', values: [] },
    ]);
  });
});
