import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
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

function formatKpiValue(value: string | number | null, format?: string): string {
  if (value === null) return '--';
  const num = Number(value);
  if (isNaN(num)) return String(value);

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num);
    case 'percent':
      return new Intl.NumberFormat('en-US', { style: 'percent', minimumFractionDigits: 1 }).format(num / 100);
    case 'compact':
      return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
    case 'decimal':
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(num);
    default:
      return new Intl.NumberFormat('en-US').format(num);
  }
}

interface KPICardProps {
  result: QueryResult;
  title: string;
  kpiFormat?: string;
  kpiCompareColumn?: string;
}

export function KPICard({ result, title, kpiFormat, kpiCompareColumn }: KPICardProps) {
  const firstRow = result.rows[0];
  if (!firstRow || firstRow.cells.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        No data
      </div>
    );
  }

  const mainValue = cellToValue(firstRow.cells[0]);
  const formattedValue = formatKpiValue(mainValue, kpiFormat);

  let changePercent: number | null = null;
  if (kpiCompareColumn) {
    const compareIdx = result.columns.findIndex((c) => c.name === kpiCompareColumn);
    if (compareIdx >= 0 && firstRow.cells[compareIdx]) {
      const compareVal = cellToValue(firstRow.cells[compareIdx]);
      if (compareVal !== null) {
        changePercent = Number(compareVal);
        if (isNaN(changePercent)) changePercent = null;
      }
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {title}
      </span>
      <span className="text-4xl font-bold tracking-tight">
        {formattedValue}
      </span>
      {changePercent !== null && (
        <div
          className={cn(
            'flex items-center gap-1 text-sm font-medium',
            changePercent > 0 && 'text-emerald-500',
            changePercent < 0 && 'text-red-500',
            changePercent === 0 && 'text-muted-foreground',
          )}
        >
          {changePercent > 0 ? (
            <TrendingUp className="size-4" />
          ) : changePercent < 0 ? (
            <TrendingDown className="size-4" />
          ) : (
            <Minus className="size-4" />
          )}
          <span>
            {changePercent > 0 ? '+' : ''}
            {changePercent.toFixed(1)}%
          </span>
        </div>
      )}
    </div>
  );
}
