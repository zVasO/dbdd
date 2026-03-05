import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
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

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

interface PieChartWidgetProps {
  result: QueryResult;
  xColumn?: string;
  yColumn?: string;
}

export function PieChartWidget({ result, xColumn, yColumn }: PieChartWidgetProps) {
  const nameIdx = xColumn
    ? result.columns.findIndex((c) => c.name === xColumn)
    : 0;
  const valueIdx = yColumn
    ? result.columns.findIndex((c) => c.name === yColumn)
    : result.columns.length > 1
      ? 1
      : 0;

  const nameKey = result.columns[nameIdx]?.name ?? 'name';
  const valueKey = result.columns[valueIdx]?.name ?? 'value';

  const data = result.rows.map((row) => ({
    [nameKey]: cellToValue(row.cells[nameIdx]),
    [valueKey]: Number(cellToValue(row.cells[valueIdx])) || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          outerRadius="70%"
          innerRadius="40%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            backgroundColor: 'hsl(var(--popover))',
            borderColor: 'hsl(var(--border))',
            borderRadius: 6,
            fontSize: 12,
            color: 'hsl(var(--popover-foreground))',
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11 }}
          iconSize={8}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
