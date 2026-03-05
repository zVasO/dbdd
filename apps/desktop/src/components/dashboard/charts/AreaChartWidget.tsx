import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
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

interface AreaChartWidgetProps {
  result: QueryResult;
  xColumn?: string;
  yColumn?: string;
}

export function AreaChartWidget({ result, xColumn, yColumn }: AreaChartWidgetProps) {
  const xIdx = xColumn
    ? result.columns.findIndex((c) => c.name === xColumn)
    : 0;
  const yIdx = yColumn
    ? result.columns.findIndex((c) => c.name === yColumn)
    : result.columns.length > 1
      ? 1
      : 0;

  const xName = result.columns[xIdx]?.name ?? 'x';
  const yName = result.columns[yIdx]?.name ?? 'y';

  const data = result.rows.map((row) => ({
    [xName]: cellToValue(row.cells[xIdx]),
    [yName]: cellToValue(row.cells[yIdx]),
  }));

  const gradientId = `area-gradient-${xName}-${yName}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.4} />
            <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey={xName}
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
        />
        <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            borderColor: 'hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
            color: 'hsl(var(--popover-foreground))',
          }}
        />
        <Area
          type="monotone"
          dataKey={yName}
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          fill={`url(#${gradientId})`}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
