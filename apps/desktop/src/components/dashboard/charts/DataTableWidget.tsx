import { cn } from '@/lib/utils';
import type { QueryResult, CellValue } from '@/lib/types';

function cellToValue(cell: CellValue): string | number | null {
  switch (cell.type) {
    case 'Null': return null;
    case 'Integer': case 'Float': return cell.value;
    case 'Boolean': return cell.value ? 1 : 0;
    case 'Text': case 'DateTime': case 'Date': case 'Time': case 'Uuid': return cell.value;
    case 'Json': return JSON.stringify(cell.value);
    case 'Bytes': return cell.value.preview;
    case 'Array': return cell.value.map(v => cellToValue(v)).join(', ');
  }
}

interface DataTableWidgetProps {
  result: QueryResult;
}

export function DataTableWidget({ result }: DataTableWidgetProps) {
  if (result.columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No columns
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="border-b bg-muted/50">
            {result.columns.map((col) => (
              <th
                key={col.name}
                className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-muted-foreground"
              >
                {col.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className={cn(
                'border-b border-border/50',
                rowIdx % 2 === 1 && 'bg-muted/20',
              )}
            >
              {row.cells.map((cell, cellIdx) => {
                const value = cellToValue(cell);
                return (
                  <td
                    key={cellIdx}
                    className={cn(
                      'max-w-[200px] truncate whitespace-nowrap px-3 py-1.5',
                      cell.type === 'Null' && 'italic text-muted-foreground',
                    )}
                    title={value !== null ? String(value) : 'NULL'}
                  >
                    {value !== null ? String(value) : 'NULL'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {result.rows.length === 0 && (
        <div className="flex h-20 items-center justify-center text-muted-foreground text-sm">
          No rows returned
        </div>
      )}
    </div>
  );
}
