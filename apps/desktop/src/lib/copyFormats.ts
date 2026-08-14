import type { ColumnMeta, Row, CellValue, ColumnData } from '@/lib/types';
import { formatColumnar, type ColumnarSlice, type CopyFormat } from '@/lib/columnarFormat';

function cellToRaw(cell: CellValue): unknown {
  switch (cell.type) {
    case 'Null': return null;
    case 'Integer':
    case 'Float': return cell.value;
    case 'Boolean': return cell.value;
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid': return cell.value;
    case 'Json': return cell.value;
    case 'Bytes': return `[${cell.value.size} bytes]`;
    case 'Array': return cell.value.map(cellToRaw);
    default: return '';
  }
}

function cellToString(cell: CellValue): string {
  switch (cell.type) {
    case 'Null': return '';
    case 'Integer':
    case 'Float': return String(cell.value);
    case 'Boolean': return cell.value ? 'true' : 'false';
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid': return cell.value;
    case 'Json': return JSON.stringify(cell.value);
    case 'Bytes': return `[${cell.value.size} bytes]`;
    case 'Array': return JSON.stringify(cell.value.map(cellToRaw));
    default: return '';
  }
}

/**
 * The three original per-cell converters (cellToRaw/cellToSql/cellToString) disagree on how
 * Json/Bytes/Array cells render, so the row->columnar bridge needs to know which target format
 * it's building a slice for in order to reproduce each one exactly through `formatColumnar`.
 * 'json' keeps Json/Array cells as real nested structures (Json kind); 'sql' and 'text' both flatten
 * them to their final string up front (Strings kind) and differ only on Bytes (NULL vs '[N bytes]').
 */
type AdapterMode = 'json' | 'sql' | 'text';

function cellForMode(cell: CellValue | undefined, mode: AdapterMode): { kind: ColumnData['kind']; value: unknown } {
  if (!cell || cell.type === 'Null') return { kind: 'Strings', value: null };
  switch (cell.type) {
    case 'Integer': return { kind: 'Integers', value: cell.value };
    case 'Float': return { kind: 'Floats', value: cell.value };
    case 'Boolean': return { kind: 'Booleans', value: cell.value };
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid':
      return { kind: 'Strings', value: cell.value };
    case 'Json':
      return mode === 'json'
        ? { kind: 'Json', value: cell.value }
        : { kind: 'Strings', value: JSON.stringify(cell.value) };
    case 'Bytes':
      return mode === 'sql'
        ? { kind: 'Strings', value: null }
        : { kind: 'Strings', value: `[${cell.value.size} bytes]` };
    case 'Array':
      return mode === 'json'
        ? { kind: 'Json', value: cell.value.map(cellToRaw) }
        : { kind: 'Strings', value: JSON.stringify(cell.value.map(cellToRaw)) };
    default:
      return { kind: 'Strings', value: null };
  }
}

function rowsToSlice(columns: ColumnMeta[], rows: Row[], mode: AdapterMode): ColumnarSlice {
  const data: ColumnData[] = columns.map((_, colIdx) => {
    let kind: ColumnData['kind'] = 'Strings';
    for (const row of rows) {
      const cell = row.cells[colIdx];
      if (cell && cell.type !== 'Null') {
        kind = cellForMode(cell, mode).kind;
        break;
      }
    }
    const values = rows.map((row) => cellForMode(row.cells[colIdx], mode).value);
    return { kind, values } as ColumnData;
  });
  return {
    columns,
    colIndexes: columns.map((_, i) => i),
    data,
    rowIndexes: rows.map((_, i) => i),
  };
}

/** Columnar entry point — the format Task 2's worker and callers with pre-columnar data use directly. */
export function copyColumnarAs(format: CopyFormat, slice: ColumnarSlice, options?: Parameters<typeof formatColumnar>[2]): string {
  return formatColumnar(slice, format, options);
}

export function copyAsJson(columns: ColumnMeta[], rows: Row[]): string {
  return formatColumnar(rowsToSlice(columns, rows, 'json'), 'json');
}

export function copyAsInsert(columns: ColumnMeta[], rows: Row[], tableName: string): string {
  return formatColumnar(rowsToSlice(columns, rows, 'sql'), 'insert', { tableName });
}

export function copyAsCsv(columns: ColumnMeta[], rows: Row[], includeHeaders = true): string {
  const out = formatColumnar(rowsToSlice(columns, rows, 'text'), 'csv');
  return includeHeaders ? out : out.split('\n').slice(1).join('\n');
}

export function copyAsMarkdown(columns: ColumnMeta[], rows: Row[]): string {
  return formatColumnar(rowsToSlice(columns, rows, 'text'), 'markdown');
}

export function copyAsTsv(columns: ColumnMeta[], rows: Row[]): string {
  return formatColumnar(rowsToSlice(columns, rows, 'text'), 'tsv');
}

export function copyCellAsJson(columnName: string, cell: CellValue): string {
  return JSON.stringify({ [columnName]: cellToRaw(cell) }, null, 2);
}

export function copyCellAsText(cell: CellValue): string {
  return cellToString(cell);
}

export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
