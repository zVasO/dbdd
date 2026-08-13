import { describe, it, expect } from 'vitest';
import { buildPendingIndex, editKey } from '../gridPendingChanges';
import type { Change } from '@/stores/changeStore';

const edit = (rowIndex: number, column: string, newValue: unknown): Change =>
  ({ type: 'edit', id: `e${rowIndex}${column}`, connectionId: 'c', table: 't',
     database: 'd', rowIndex, primaryKeys: {}, column, oldValue: null, newValue } as Change);
const del = (rowIndex: number): Change =>
  ({ type: 'delete', id: `d${rowIndex}`, connectionId: 'c', table: 't',
     database: 'd', rowIndex, primaryKeys: {}, originalRow: {} } as Change);
const ins = (id: string): Change =>
  ({ type: 'insert', id, connectionId: 'c', table: 't', database: 'd', values: {} } as never);

describe('buildPendingIndex', () => {
  it('indexes edits by row:column', () => {
    const idx = buildPendingIndex([edit(3, 'name', 'x'), del(5)]);
    expect(idx.edits.get(editKey(3, 'name'))?.newValue).toBe('x');
    expect(idx.edits.get(editKey(3, 'other'))).toBeUndefined();
  });

  it('keeps the FIRST edit for a cell, mirroring Array.find', () => {
    const idx = buildPendingIndex([edit(1, 'a', 'first'), edit(1, 'a', 'second')]);
    expect(idx.edits.get(editKey(1, 'a'))?.newValue).toBe('first');
  });

  it('collects deleted row indexes', () => {
    const idx = buildPendingIndex([del(2), del(7), edit(2, 'a', 1)]);
    expect(idx.deletedRows.has(2)).toBe(true);
    expect(idx.deletedRows.has(7)).toBe(true);
    expect(idx.deletedRows.has(3)).toBe(false);
  });

  it('collects inserts in order', () => {
    const idx = buildPendingIndex([ins('i1'), del(1), ins('i2')]);
    expect(idx.inserts.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('returns empty indexes for an empty list', () => {
    const idx = buildPendingIndex([]);
    expect(idx.edits.size).toBe(0);
    expect(idx.deletedRows.size).toBe(0);
    expect(idx.inserts).toEqual([]);
  });
});
