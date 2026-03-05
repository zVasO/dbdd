import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import type { QueryResult, CellValue } from '@/lib/types';

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

function cellToSqlLiteral(cell: CellValue): string {
  switch (cell.type) {
    case 'Null':
      return 'NULL';
    case 'Integer':
    case 'Float':
      return String(cell.value);
    case 'Boolean':
      return cell.value ? 'TRUE' : 'FALSE';
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid':
      return `'${String(cell.value).replace(/'/g, "''")}'`;
    case 'Json':
      return `'${JSON.stringify(cell.value).replace(/'/g, "''")}'`;
    case 'Bytes':
      return 'NULL';
    case 'Array':
      return `'${JSON.stringify(cell.value.map(cellValueToJS)).replace(/'/g, "''")}'`;
    default:
      return 'NULL';
  }
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

export function toCSV(result: QueryResult, options?: CsvOptions): string {
  const data = resultToObjectArray(result);
  return Papa.unparse(data, {
    delimiter: options?.separator ?? ',',
    header: options?.includeHeaders !== false,
  });
}

export interface JsonOptions {
  pretty?: boolean;
}

export function toJSON(result: QueryResult, options?: JsonOptions): string {
  const data = resultToObjectArray(result);
  if (options?.pretty !== false) {
    return JSON.stringify(data, null, 2);
  }
  return JSON.stringify(data);
}

export function toExcel(result: QueryResult): ArrayBuffer {
  const data = resultToObjectArray(result);
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buf = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return buf as ArrayBuffer;
}

export function toSQLInsert(result: QueryResult, tableName: string): string {
  if (result.rows.length === 0) return `-- No data to export from ${tableName}`;

  const colNames = result.columns.map((c) => `\`${c.name}\``).join(', ');
  const lines: string[] = [];

  for (const row of result.rows) {
    const vals = result.columns.map((_, i) => cellToSqlLiteral(row.cells[i])).join(', ');
    lines.push(`INSERT INTO \`${tableName}\` (${colNames}) VALUES (${vals});`);
  }

  return lines.join('\n');
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

  const header = '| ' + result.columns.map((c) => c.name).join(' | ') + ' |';
  const separator = '| ' + result.columns.map(() => '---').join(' | ') + ' |';
  const rows = result.rows.map((row) => {
    const cells = result.columns.map((_, i) => {
      const val = cellValueToJS(row.cells[i]);
      const str = val === null ? 'NULL' : String(val);
      return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    });
    return '| ' + cells.join(' | ') + ' |';
  });

  return [header, separator, ...rows].join('\n');
}
