import type { ColumnMeta, Row, CellValue } from '@/lib/types';

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

function cellToSql(cell: CellValue): string {
  switch (cell.type) {
    case 'Null': return 'NULL';
    case 'Integer':
    case 'Float': return String(cell.value);
    case 'Boolean': return cell.value ? 'TRUE' : 'FALSE';
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid': return `'${String(cell.value).replace(/'/g, "''")}'`;
    case 'Json': return `'${JSON.stringify(cell.value).replace(/'/g, "''")}'`;
    case 'Bytes': return 'NULL';
    case 'Array': return `'${JSON.stringify(cell.value.map(cellToRaw)).replace(/'/g, "''")}'`;
    default: return 'NULL';
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

export function copyAsJson(columns: ColumnMeta[], rows: Row[]): string {
  const data = rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col.name] = cellToRaw(row.cells[i]);
    });
    return obj;
  });
  return JSON.stringify(data, null, 2);
}

export function copyAsInsert(columns: ColumnMeta[], rows: Row[], tableName: string): string {
  if (rows.length === 0) return '';
  const colNames = columns.map((c) => `\`${c.name}\``).join(', ');
  const values = rows.map((row) => {
    const vals = columns.map((_, i) => cellToSql(row.cells[i])).join(', ');
    return `(${vals})`;
  });
  return `INSERT INTO \`${tableName}\` (${colNames}) VALUES\n${values.join(',\n')};`;
}

export function copyAsCsv(columns: ColumnMeta[], rows: Row[], includeHeaders = true): string {
  const escape = (s: string) => {
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines: string[] = [];
  if (includeHeaders) {
    lines.push(columns.map((c) => escape(c.name)).join(','));
  }
  for (const row of rows) {
    lines.push(columns.map((_, i) => escape(cellToString(row.cells[i]))).join(','));
  }
  return lines.join('\n');
}

export function copyAsMarkdown(columns: ColumnMeta[], rows: Row[]): string {
  const header = '| ' + columns.map((c) => c.name).join(' | ') + ' |';
  const sep = '| ' + columns.map(() => '---').join(' | ') + ' |';
  const body = rows.map(
    (row) => '| ' + columns.map((_, i) => cellToString(row.cells[i]).replace(/\|/g, '\\|')).join(' | ') + ' |',
  );
  return [header, sep, ...body].join('\n');
}

export function copyAsTsv(columns: ColumnMeta[], rows: Row[]): string {
  const header = columns.map((c) => c.name).join('\t');
  const body = rows.map((row) =>
    columns.map((_, i) => cellToString(row.cells[i])).join('\t')
  );
  return [header, ...body].join('\n');
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
