import type { QueryResult, CellValue, ColumnData } from '@/lib/types';
import { formatColumnar, type ColumnarSlice } from '@/lib/columnarFormat';

/** Convert a tagged CellValue union to a plain JS primitive. */
export function cellValueToJS(cell: CellValue): string | number | boolean | null {
  switch (cell.type) {
    case 'Null':
      return null;
    case 'Integer':
    case 'Float':
      return cell.value;
    case 'Boolean':
      return cell.value;
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid':
      return cell.value;
    case 'Json':
      return JSON.stringify(cell.value);
    case 'Bytes':
      return `[${cell.value.size} bytes]`;
    case 'Array':
      return JSON.stringify(cell.value.map(cellValueToJS));
    default:
      return null;
  }
}

/**
 * Row->columnar bridge for the delegated formats below. Mirrors copyFormats.ts's `cellForMode`:
 * 'json' keeps Json/Array cells as real nested structures so `formatColumnar`'s JSON format can
 * emit them unstringified (copyFormats' contract); 'sql' and 'text' flatten them to their final
 * string up front and differ only on Bytes (NULL vs '[N bytes]').
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
        ? { kind: 'Json', value: cell.value.map(cellValueToJS) }
        : { kind: 'Strings', value: JSON.stringify(cell.value.map(cellValueToJS)) };
    default:
      return { kind: 'Strings', value: null };
  }
}

function resultToSlice(result: QueryResult, mode: AdapterMode): ColumnarSlice {
  const { columns, rows } = result;
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

function resultToObjectArray(result: QueryResult): Record<string, string | number | boolean | null>[] {
  return result.rows.map((row) => {
    const obj: Record<string, string | number | boolean | null> = {};
    result.columns.forEach((col, i) => {
      obj[col.name] = cellValueToJS(row.cells[i]);
    });
    return obj;
  });
}

export interface CsvOptions {
  separator?: string;
  includeHeaders?: boolean;
}

export async function toCSV(result: QueryResult, options?: CsvOptions): Promise<string> {
  const out = formatColumnar(resultToSlice(result, 'text'), 'csv', { delimiter: options?.separator ?? ',' });
  return options?.includeHeaders === false ? out.split('\n').slice(1).join('\n') : out;
}

export interface JsonOptions {
  pretty?: boolean;
}

export function toJSON(result: QueryResult, options?: JsonOptions): string {
  return formatColumnar(resultToSlice(result, 'json'), 'json', { pretty: options?.pretty !== false });
}

export async function toExcel(result: QueryResult): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx');
  const data = resultToObjectArray(result);
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return buf as ArrayBuffer;
}

export function toSQLInsert(result: QueryResult, tableName: string): string {
  if (result.rows.length === 0) return `-- No data to export from ${tableName}`;
  return formatColumnar(resultToSlice(result, 'sql'), 'insert', { tableName });
}

function sqlTypeFromDataType(dataType: string): string {
  const dt = dataType.toLowerCase();
  if (dt.includes('int')) return 'INT';
  if (dt.includes('serial')) return 'INT AUTO_INCREMENT';
  if (dt.includes('float') || dt.includes('double') || dt.includes('decimal') || dt.includes('numeric') || dt.includes('real')) return 'DOUBLE';
  if (dt.includes('bool')) return 'BOOLEAN';
  if (dt.includes('date') && dt.includes('time')) return 'DATETIME';
  if (dt.includes('date')) return 'DATE';
  if (dt.includes('time')) return 'TIME';
  if (dt.includes('text') || dt.includes('clob')) return 'TEXT';
  if (dt.includes('blob') || dt.includes('bytea') || dt.includes('binary')) return 'BLOB';
  if (dt.includes('json')) return 'JSON';
  if (dt.includes('uuid')) return 'VARCHAR(36)';
  if (dt.includes('char') || dt.includes('varchar')) {
    return dataType.toUpperCase();
  }
  return 'TEXT';
}

export function toSQLCreateAndInsert(result: QueryResult, tableName: string): string {
  const lines: string[] = [];

  // CREATE TABLE
  const colDefs = result.columns.map((col) => {
    const dtStr = typeof col.data_type === 'string' ? col.data_type : (col.native_type || 'text');
    const sqlType = sqlTypeFromDataType(dtStr);
    const nullable = col.nullable ? '' : ' NOT NULL';
    const pk = col.is_primary_key ? ' PRIMARY KEY' : '';
    return `  \`${col.name}\` ${sqlType}${nullable}${pk}`;
  });

  lines.push(`CREATE TABLE \`${tableName}\` (`);
  lines.push(colDefs.join(',\n'));
  lines.push(');');
  lines.push('');

  // INSERT statements
  lines.push(toSQLInsert(result, tableName));

  return lines.join('\n');
}

export function toMarkdown(result: QueryResult): string {
  if (result.columns.length === 0) return '';
  return formatColumnar(resultToSlice(result, 'text'), 'markdown');
}
