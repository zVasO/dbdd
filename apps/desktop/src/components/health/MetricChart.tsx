import { useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import { cn } from '@/lib/utils';
import type { MetricDataPoint } from '@/stores/monitoringStore';

export interface MetricChartProps {
  title: string;
  data: MetricDataPoint[];
  color: string;
  unit?: string; // '%', '/s', ''
  format?: (value: number) => string;
}

function defaultFormat(value: number, unit?: string): string {
  if (unit === '%') {
    return `${value.toFixed(1)}%`;
  }
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M${unit ?? ''}`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K${unit ?? ''}`;
  }
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)}${unit ?? ''}`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: number;
  unit?: string;
  formatFn: (value: number) => string;
}

function CustomTooltip({ active, payload, label, formatFn }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0 || label === undefined) {
    return null;
  }
  return (
    <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium">{formatFn(payload[0].value)}</p>
      <p className="text-muted-foreground">{formatTime(label)}</p>
    </div>
  );
}

export function MetricChart({ title, data, color, unit, format }: MetricChartProps) {
  const gradientId = useMemo(
    () => `gradient-${title.replace(/\s+/g, '-').toLowerCase()}`,
    [title],
  );

  const currentValue = data.length > 0 ? data[data.length - 1].value : 0;

  const formatFn = useMemo(
    () => format ?? ((v: number) => defaultFormat(v, unit)),
    [format, unit],
  );

  const chartData = useMemo(
    () => data.map((d) => ({ timestamp: d.timestamp, value: d.value })),
    [data],
  );

  return (
    <div className="relative flex flex-col rounded-lg border bg-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <span
          className={cn('text-lg font-bold tabular-nums')}
          style={{ color }}
        >
          {formatFn(currentValue)}
        </span>
      </div>

      {/* Chart */}
      <div className="h-[140px] w-full">
        {data.length < 2 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            Collecting data...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="timestamp"
                type="number"
                domain={['dataMin', 'dataMax']}
                tickFormatter={formatTime}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={unit === '%' ? [0, 100] : ['auto', 'auto']}
                tick={{ fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={36}
                tickFormatter={(v: number) => defaultFormat(v, unit)}
              />
              <Tooltip
                content={
                  <CustomTooltip formatFn={formatFn} unit={unit} />
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 3, fill: color, stroke: 'var(--background)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
