/// <reference lib="webworker" />

interface ExportMessage {
  type: 'export';
  format: 'csv' | 'json' | 'sql-insert' | 'sql-create' | 'markdown';
  columns: { name: string; data_type: string; native_type: string; nullable: boolean; is_primary_key: boolean }[];
  rows: { cells: { type: string; value: unknown }[] }[];
  tableName: string;
  options?: { pretty?: boolean; separator?: string };
}

function cellValueToJS(cell: { type: string; value: unknown }): string | number | boolean | null {
  switch (cell.type) {
    case 'Null': return null;
    case 'Integer':
    case 'Float': return cell.value as number;
    case 'Boolean': return cell.value as boolean;
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid': return cell.value as string;
    case 'Json': return JSON.stringify(cell.value);
    case 'Bytes': return '[bytes]';
    case 'Array': return JSON.stringify(cell.value);
    default: return null;
  }
}

function cellToSqlLiteral(cell: { type: string; value: unknown }): string {
  switch (cell.type) {
    case 'Null': return 'NULL';
    case 'Integer':
    case 'Float': return String(cell.value);
    case 'Boolean': return (cell.value as boolean) ? 'TRUE' : 'FALSE';
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid': return `'${String(cell.value).replace(/'/g, "''")}'`;
    case 'Json': return `'${JSON.stringify(cell.value).replace(/'/g, "''")}'`;
    default: return 'NULL';
  }
}

function toObjectArray(
  columns: ExportMessage['columns'],
  rows: ExportMessage['rows'],
): Record<string, string | number | boolean | null>[] {
  return rows.map((row) => {
    const obj: Record<string, string | number | boolean | null> = {};
    columns.forEach((col, i) => {
      obj[col.name] = cellValueToJS(row.cells[i]);
    });
    return obj;
  });
}

self.onmessage = (e: MessageEvent<ExportMessage>) => {
  const { format, columns, rows, tableName, options } = e.data;

  try {
    let content: string;

    switch (format) {
      case 'csv': {
        const data = toObjectArray(columns, rows);
        const headers = columns.map((c) => c.name);
        const sep = options?.separator ?? ',';
        const escapeCsv = (val: string | number | boolean | null) => {
          if (val === null) return '';
          const str = String(val);
          return str.includes(sep) || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"` : str;
        };
        const lines = [headers.join(sep)];
        for (const row of data) {
          lines.push(headers.map((h) => escapeCsv(row[h])).join(sep));
        }
        content = lines.join('\n');
        break;
      }
      case 'json': {
        const data = toObjectArray(columns, rows);
        content = options?.pretty !== false ? JSON.stringify(data, null, 2) : JSON.stringify(data);
        break;
      }
      case 'sql-insert': {
        const colNames = columns.map((c) => `\`${c.name}\``).join(', ');
        const lines: string[] = [];
        for (const row of rows) {
          const vals = columns.map((_, i) => cellToSqlLiteral(row.cells[i])).join(', ');
          lines.push(`INSERT INTO \`${tableName}\` (${colNames}) VALUES (${vals});`);
        }
        content = lines.join('\n');
        break;
      }
      case 'sql-create': {
        const sqlType = (dt: string) => {
          const d = dt.toLowerCase();
          if (d.includes('int')) return 'INT';
          if (d.includes('float') || d.includes('double') || d.includes('decimal')) return 'DOUBLE';
          if (d.includes('bool')) return 'BOOLEAN';
          if (d.includes('json')) return 'JSON';
          if (d.includes('date') && d.includes('time')) return 'DATETIME';
          if (d.includes('date')) return 'DATE';
          if (d.includes('time')) return 'TIME';
          return 'TEXT';
        };
        const colDefs = columns.map((col) => {
          const t = sqlType(typeof col.data_type === 'string' ? col.data_type : 'text');
          const nullable = col.nullable ? '' : ' NOT NULL';
          const pk = col.is_primary_key ? ' PRIMARY KEY' : '';
          return `  \`${col.name}\` ${t}${nullable}${pk}`;
        });
        const lines = [`CREATE TABLE \`${tableName}\` (`, colDefs.join(',\n'), ');', ''];
        const colNames = columns.map((c) => `\`${c.name}\``).join(', ');
        for (const row of rows) {
          const vals = columns.map((_, i) => cellToSqlLiteral(row.cells[i])).join(', ');
          lines.push(`INSERT INTO \`${tableName}\` (${colNames}) VALUES (${vals});`);
        }
        content = lines.join('\n');
        break;
      }
      case 'markdown': {
        if (columns.length === 0) { content = ''; break; }
        const header = '| ' + columns.map((c) => c.name).join(' | ') + ' |';
        const separator = '| ' + columns.map(() => '---').join(' | ') + ' |';
        const mdRows = rows.map((row) => {
          const cells = columns.map((_, i) => {
            const val = cellValueToJS(row.cells[i]);
            const str = val === null ? 'NULL' : String(val);
            return str.replace(/\|/g, '\\|').replace(/\n/g, ' ');
          });
          return '| ' + cells.join(' | ') + ' |';
        });
        content = [header, separator, ...mdRows].join('\n');
        break;
      }
      default:
        content = '';
    }

    self.postMessage({ type: 'export-result', content });
  } catch (err) {
    self.postMessage({ type: 'export-error', error: String(err) });
  }
};
