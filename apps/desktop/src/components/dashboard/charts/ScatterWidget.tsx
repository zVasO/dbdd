import {
  ScatterChart,
  Scatter,
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

interface ScatterWidgetProps {
  result: QueryResult;
  xColumn?: string;
  yColumn?: string;
}

export function ScatterWidget({ result, xColumn, yColumn }: ScatterWidgetProps) {
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
    [xName]: Number(cellToValue(row.cells[xIdx])) || 0,
    [yName]: Number(cellToValue(row.cells[yIdx])) || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          type="number"
          dataKey={xName}
          name={xName}
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
        />
        <YAxis
          type="number"
          dataKey={yName}
          name={yName}
          tick={{ fontSize: 11 }}
          className="text-muted-foreground"
        />
        <Tooltip
          cursor={{ strokeDasharray: '3 3' }}
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            borderColor: 'hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
            color: 'hsl(var(--popover-foreground))',
          }}
        />
        <Scatter
          data={data}
          fill="hsl(var(--chart-1))"
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
