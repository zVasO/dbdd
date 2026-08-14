import type { ColumnData, ColumnMeta } from './types';

export interface ColumnarSlice {
  columns: ColumnMeta[]; // the columns to emit, in output order
  colIndexes: number[]; // parallel: index of each column in `data`
  data: ColumnData[]; // full columnar arrays (NOT sliced)
  rowIndexes: number[]; // actual row indexes to emit, in output order
}

export type CopyFormat = 'csv' | 'tsv' | 'json' | 'markdown' | 'insert' | 'create';

export interface FormatColumnarOptions {
  tableName?: string; // insert/create
  pretty?: boolean; // json
  delimiter?: string; // csv override
}

type DisplayValue = string | number | boolean | null;

/** Build a display primitive from columnar data — mirrors columnarCellValue's (GridRow.tsx) extraction. */
export function cellToDisplay(data: ColumnData[], colIndex: number, rowIndex: number): DisplayValue {
  const col = data[colIndex];
  if (!col) return null;
  const val = col.values[rowIndex];
  if (val == null) return null;
  switch (col.kind) {
    case 'Integers':
    case 'Floats':
      return val as number;
    case 'Booleans':
      return val as boolean;
    case 'Strings':
      return val as string;
    case 'Json':
      return JSON.stringify(val);
  }
}

/** Raw (unstringified) value — only the 'json' format needs this, matching copyFormats' Json contract. */
function cellToRaw(data: ColumnData[], colIndex: number, rowIndex: number): unknown {
  const col = data[colIndex];
  if (!col) return null;
  const val = col.values[rowIndex];
  return val == null ? null : val;
}

function csvEscape(s: string, delimiter: string): string {
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function displayToText(val: DisplayValue): string {
  if (val === null) return '';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  return String(val);
}

function displayToSqlLiteral(val: DisplayValue): string {
  if (val === null) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${val.replace(/'/g, "''")}'`;
}

/** Ported from workers/export.worker.ts's 'sql-create' — its only unique feature. */
function sqlTypeFromDataType(dataType: string): string {
  const d = dataType.toLowerCase();
  if (d.includes('int')) return 'INT';
  if (d.includes('float') || d.includes('double') || d.includes('decimal')) return 'DOUBLE';
  if (d.includes('bool')) return 'BOOLEAN';
  if (d.includes('json')) return 'JSON';
  if (d.includes('date') && d.includes('time')) return 'DATETIME';
  if (d.includes('date')) return 'DATE';
  if (d.includes('time')) return 'TIME';
  return 'TEXT';
}

function formatDelimited(slice: ColumnarSlice, delimiter: string, escape: (s: string) => string): string {
  const { columns, colIndexes, data, rowIndexes } = slice;
  const lines = [columns.map((c) => escape(c.name)).join(delimiter)];
  for (const r of rowIndexes) {
    lines.push(colIndexes.map((ci) => escape(displayToText(cellToDisplay(data, ci, r)))).join(delimiter));
  }
  return lines.join('\n');
}

function formatJson(slice: ColumnarSlice, pretty: boolean): string {
  const { columns, colIndexes, data, rowIndexes } = slice;
  const arr = rowIndexes.map((r) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, j) => {
      obj[col.name] = cellToRaw(data, colIndexes[j], r);
    });
    return obj;
  });
  return pretty ? JSON.stringify(arr, null, 2) : JSON.stringify(arr);
}

function formatMarkdown(slice: ColumnarSlice): string {
  const { columns, colIndexes, data, rowIndexes } = slice;
  const header = '| ' + columns.map((c) => c.name).join(' | ') + ' |';
  const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
  const body = rowIndexes.map(
    (r) =>
      '| ' +
      colIndexes.map((ci) => displayToText(cellToDisplay(data, ci, r)).replace(/\|/g, '\\|')).join(' | ') +
      ' |',
  );
  return [header, sep, ...body].join('\n');
}

function formatInsert(slice: ColumnarSlice, tableName: string): string {
  const { columns, colIndexes, data, rowIndexes } = slice;
  if (rowIndexes.length === 0) return '';
  const colNames = columns.map((c) => `\`${c.name}\``).join(', ');
  const values = rowIndexes.map((r) => {
    const vals = colIndexes.map((ci) => displayToSqlLiteral(cellToDisplay(data, ci, r))).join(', ');
    return `(${vals})`;
  });
  return `INSERT INTO \`${tableName}\` (${colNames}) VALUES\n${values.join(',\n')};`;
}

function formatCreate(slice: ColumnarSlice, tableName: string): string {
  const colDefs = slice.columns.map((col) => {
    const dtStr = typeof col.data_type === 'string' ? col.data_type : 'text';
    const sqlType = sqlTypeFromDataType(dtStr);
    const nullable = col.nullable ? '' : ' NOT NULL';
    const pk = col.is_primary_key ? ' PRIMARY KEY' : '';
    return `  \`${col.name}\` ${sqlType}${nullable}${pk}`;
  });
  const createBlock = [`CREATE TABLE \`${tableName}\` (`, colDefs.join(',\n'), ');', ''].join('\n');
  const insertBlock = formatInsert(slice, tableName);
  return createBlock + '\n' + insertBlock;
}

export function formatColumnar(slice: ColumnarSlice, format: CopyFormat, options?: FormatColumnarOptions): string {
  const tableName = options?.tableName ?? 'table';
  switch (format) {
    case 'csv':
      return formatDelimited(slice, options?.delimiter ?? ',', (s) => csvEscape(s, options?.delimiter ?? ','));
    case 'tsv':
      return formatDelimited(slice, '\t', (s) => s);
    case 'json':
      return formatJson(slice, options?.pretty !== false);
    case 'markdown':
      return formatMarkdown(slice);
    case 'insert':
      return formatInsert(slice, tableName);
    case 'create':
      return formatCreate(slice, tableName);
  }
}
