import { describe, it, expect } from 'vitest';
import { formatColumnar, cellToDisplay } from '../columnarFormat';
import type { ColumnarSlice } from '../columnarFormat';

const slice = (): ColumnarSlice => ({
  columns: [
    { name: 'id', data_type: 'int4', nullable: false } as never,
    { name: 'name', data_type: 'text', nullable: true } as never,
  ],
  colIndexes: [0, 1],
  data: [
    { kind: 'Integers', values: [1, 2, null] },
    { kind: 'Strings', values: ['a', null, 'c, "q"'] },
  ],
  rowIndexes: [0, 2],
});

describe('formatColumnar', () => {
  it('csv quotes and escapes like copyFormats did', () => {
    const out = formatColumnar(slice(), 'csv');
    expect(out.split('\n')[0]).toBe('id,name');
    expect(out.split('\n')[1]).toBe('1,a');
    expect(out).toContain('"c, ""q"""'); // comma+quote inside a field gets quoted and escaped
  });

  it('tsv joins with tabs and does not escape', () => {
    expect(formatColumnar(slice(), 'tsv').split('\n')[0]).toBe('id\tname');
    expect(formatColumnar(slice(), 'tsv').split('\n')[1]).toBe('1\ta');
  });

  it('json emits an array of objects with raw (unstringified) values', () => {
    const parsed = JSON.parse(formatColumnar(slice(), 'json'));
    expect(parsed).toEqual([
      { id: 1, name: 'a' },
      { id: null, name: 'c, "q"' },
    ]);
  });

  it('json respects pretty:false for compact output', () => {
    const out = formatColumnar(slice(), 'json', { pretty: false });
    expect(out).not.toContain('\n');
    expect(JSON.parse(out)).toEqual([
      { id: 1, name: 'a' },
      { id: null, name: 'c, "q"' },
    ]);
  });

  it('insert emits ONE multi-row statement (copyFormats semantics)', () => {
    const out = formatColumnar(slice(), 'insert', { tableName: 't' });
    expect(out.match(/INSERT INTO/g)).toHaveLength(1);
    expect(out).toContain('VALUES');
    expect(out).toContain('NULL');
    expect(out).toContain('`id`, `name`');
  });

  it('markdown renders a header separator row', () => {
    const lines = formatColumnar(slice(), 'markdown').split('\n');
    expect(lines[0]).toBe('| id | name |');
    expect(lines[1]).toMatch(/^\|?\s*-+/);
  });

  it('respects rowIndexes order and skips unlisted rows', () => {
    const s = { ...slice(), rowIndexes: [2, 0] };
    const lines = formatColumnar(s, 'csv').split('\n');
    expect(lines[1].startsWith('')).toBe(true); // row 2 first (id null)
    expect(lines[2].startsWith('1')).toBe(true);
  });

  it('respects colIndexes/columns to emit a reordered subset of columns', () => {
    const s: ColumnarSlice = {
      ...slice(),
      columns: [{ name: 'name', data_type: 'text', nullable: true } as never],
      colIndexes: [1],
    };
    const out = formatColumnar(s, 'csv');
    expect(out.split('\n')[0]).toBe('name');
    expect(out.split('\n')[1]).toBe('a');
  });

  it('create emits CREATE TABLE followed by a multi-row INSERT (ported from the worker)', () => {
    const out = formatColumnar(slice(), 'create', { tableName: 't' });
    expect(out).toContain('CREATE TABLE `t` (');
    expect(out).toContain('`id` INT NOT NULL');
    expect(out).toContain('`name` TEXT');
    expect(out.match(/INSERT INTO/g)).toHaveLength(1);
  });
});

describe('cellToDisplay', () => {
  it('extracts primitives matching columnarCellValue semantics', () => {
    const data = slice().data;
    expect(cellToDisplay(data, 0, 0)).toBe(1);
    expect(cellToDisplay(data, 0, 2)).toBe(null);
    expect(cellToDisplay(data, 1, 0)).toBe('a');
  });

  it('stringifies Json-kind values for display', () => {
    const data: ColumnarSlice['data'] = [{ kind: 'Json', values: [{ a: 1 }, null] }];
    expect(cellToDisplay(data, 0, 0)).toBe(JSON.stringify({ a: 1 }));
    expect(cellToDisplay(data, 0, 1)).toBe(null);
  });

  it('returns booleans as-is', () => {
    const data: ColumnarSlice['data'] = [{ kind: 'Booleans', values: [true, false, null] }];
    expect(cellToDisplay(data, 0, 0)).toBe(true);
    expect(cellToDisplay(data, 0, 1)).toBe(false);
    expect(cellToDisplay(data, 0, 2)).toBe(null);
  });
});
