import { useState, useCallback, useEffect } from 'react';
import {
  BarChart3, LineChart, PieChart, AreaChart, ScatterChart,
  Gauge, Table2, Type, Play, Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ipc } from '@/lib/ipc';
import type { QueryResult } from '@/lib/types';
import type { ChartType, DashboardWidget, WidgetConfig } from '@/stores/dashboardStore';

const CHART_OPTIONS: { type: ChartType; label: string; icon: React.ReactNode }[] = [
  { type: 'bar', label: 'Bar', icon: <BarChart3 className="size-4" /> },
  { type: 'line', label: 'Line', icon: <LineChart className="size-4" /> },
  { type: 'pie', label: 'Pie', icon: <PieChart className="size-4" /> },
  { type: 'area', label: 'Area', icon: <AreaChart className="size-4" /> },
  { type: 'scatter', label: 'Scatter', icon: <ScatterChart className="size-4" /> },
  { type: 'kpi', label: 'KPI', icon: <Gauge className="size-4" /> },
  { type: 'table', label: 'Table', icon: <Table2 className="size-4" /> },
  { type: 'text', label: 'Text', icon: <Type className="size-4" /> },
];

const REFRESH_OPTIONS = [
  { value: '0', label: 'Manual only' },
  { value: '30', label: 'Every 30s' },
  { value: '60', label: 'Every 1m' },
  { value: '300', label: 'Every 5m' },
  { value: '600', label: 'Every 10m' },
  { value: '1800', label: 'Every 30m' },
];

const KPI_FORMAT_OPTIONS = [
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Currency ($)' },
  { value: 'percent', label: 'Percent (%)' },
  { value: 'compact', label: 'Compact (1.2K)' },
  { value: 'decimal', label: 'Decimal' },
];

interface WidgetConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  widget?: DashboardWidget;
  onSave: (widget: Omit<DashboardWidget, 'id'>) => void;
}

export function WidgetConfigDialog({
  open,
  onOpenChange,
  connectionId,
  widget,
  onSave,
}: WidgetConfigDialogProps) {
  const [title, setTitle] = useState(widget?.title ?? '');
  const [chartType, setChartType] = useState<ChartType>(widget?.type ?? 'bar');
  const [sql, setSql] = useState(widget?.sql ?? '');
  const [config, setConfig] = useState<WidgetConfig>(widget?.config ?? {});
  const [testResult, setTestResult] = useState<QueryResult | null>(widget?.result ?? null);
  const [testLoading, setTestLoading] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  // Reset form state when dialog opens or widget changes
  useEffect(() => {
    if (open) {
      setTitle(widget?.title ?? '');
      setChartType(widget?.type ?? 'bar');
      setSql(widget?.sql ?? '');
      setConfig(widget?.config ?? {});
      setTestResult(widget?.result ?? null);
      setTestLoading(false);
      setTestError(null);
    }
  }, [open, widget]);

  const columns = testResult?.columns ?? [];

  const handleRunQuery = useCallback(async () => {
    if (!connectionId || !sql.trim()) return;
    setTestLoading(true);
    setTestError(null);
    setTestResult(null);
    try {
      const result = await ipc.executeQuery(connectionId, sql);
      setTestResult(result);
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTestLoading(false);
    }
  }, [connectionId, sql]);

  const handleSave = () => {
    onSave({
      type: chartType,
      title: title.trim() || 'Untitled Widget',
      sql,
      config,
      result: testResult ?? undefined,
    });
    onOpenChange(false);
  };

  const updateConfig = (updates: Partial<WidgetConfig>) => {
    setConfig((prev) => ({ ...prev, ...updates }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{widget ? 'Edit Widget' : 'Add Widget'}</DialogTitle>
          <DialogDescription>
            Configure the widget's chart type, SQL query, and column mappings.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Title */}
          <div className="grid gap-2">
            <Label htmlFor="widget-title">Title</Label>
            <Input
              id="widget-title"
              placeholder="Widget title..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Chart Type Selector */}
          <div className="grid gap-2">
            <Label>Chart Type</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {CHART_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  onClick={() => setChartType(opt.type)}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-md border p-2 text-xs transition-colors',
                    chartType === opt.type
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* SQL Query */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="widget-sql">SQL Query</Label>
              <Button
                variant="outline"
                size="xs"
                onClick={handleRunQuery}
                disabled={testLoading || !connectionId || !sql.trim()}
              >
                {testLoading ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Play className="size-3" />
                )}
                Run Query
              </Button>
            </div>
            <textarea
              id="widget-sql"
              className="h-28 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30"
              placeholder="SELECT column1, column2 FROM table_name..."
              value={sql}
              onChange={(e) => setSql(e.target.value)}
            />
            {testError && (
              <p className="text-xs text-destructive">{testError}</p>
            )}
            {testResult && (
              <p className="text-xs text-muted-foreground">
                Returned {testResult.rows.length} row(s) with {testResult.columns.length} column(s) in {testResult.execution_time_ms}ms
              </p>
            )}
          </div>

          {/* Column Mappings (only for chart types that use them) */}
          {chartType !== 'text' && columns.length > 0 && (
            <div className="grid gap-3">
              <Label className="text-muted-foreground text-xs uppercase tracking-wider">
                Column Mapping
              </Label>
              <div className="grid grid-cols-2 gap-3">
                {/* X Column */}
                {['bar', 'line', 'pie', 'area', 'scatter'].includes(chartType) && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="x-col" className="text-xs">
                      {chartType === 'pie' ? 'Name Column' : 'X Axis'}
                    </Label>
                    <Select
                      value={config.xColumn ?? ''}
                      onValueChange={(val) => updateConfig({ xColumn: val })}
                    >
                      <SelectTrigger id="x-col" size="sm">
                        <SelectValue placeholder="Auto-detect" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Y Column */}
                {['bar', 'line', 'pie', 'area', 'scatter'].includes(chartType) && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="y-col" className="text-xs">
                      {chartType === 'pie' ? 'Value Column' : 'Y Axis'}
                    </Label>
                    <Select
                      value={config.yColumn ?? ''}
                      onValueChange={(val) => updateConfig({ yColumn: val })}
                    >
                      <SelectTrigger id="y-col" size="sm">
                        <SelectValue placeholder="Auto-detect" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* KPI Format */}
                {chartType === 'kpi' && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="kpi-format" className="text-xs">KPI Format</Label>
                    <Select
                      value={config.kpiFormat ?? 'number'}
                      onValueChange={(val) => updateConfig({ kpiFormat: val })}
                    >
                      <SelectTrigger id="kpi-format" size="sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KPI_FORMAT_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* KPI Compare Column */}
                {chartType === 'kpi' && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="kpi-compare" className="text-xs">Compare Column (%)</Label>
                    <Select
                      value={config.kpiCompareColumn ?? ''}
                      onValueChange={(val) => updateConfig({ kpiCompareColumn: val })}
                    >
                      <SelectTrigger id="kpi-compare" size="sm">
                        <SelectValue placeholder="None" />
                      </SelectTrigger>
                      <SelectContent>
                        {columns.map((col) => (
                          <SelectItem key={col.name} value={col.name}>
                            {col.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Refresh Interval */}
          {chartType !== 'text' && (
            <div className="grid gap-2">
              <Label htmlFor="refresh-interval">Auto Refresh</Label>
              <Select
                value={String(config.refreshInterval ?? 0)}
                onValueChange={(val) => updateConfig({ refreshInterval: Number(val) })}
              >
                <SelectTrigger id="refresh-interval" size="sm" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REFRESH_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>
            {widget ? 'Save Changes' : 'Add Widget'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
