import { useState } from 'react';
import { RefreshCw, Settings, Trash2, AlertCircle, Loader2, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { DashboardWidget } from '@/stores/dashboardStore';
import { BarChartWidget } from './charts/BarChartWidget';
import { LineChartWidget } from './charts/LineChartWidget';
import { PieChartWidget } from './charts/PieChartWidget';
import { AreaChartWidget } from './charts/AreaChartWidget';
import { ScatterWidget } from './charts/ScatterWidget';
import { KPICard } from './charts/KPICard';
import { DataTableWidget } from './charts/DataTableWidget';

interface WidgetCardProps {
  widget: DashboardWidget;
  onRefresh: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function WidgetCard({ widget, onRefresh, onEdit, onDelete }: WidgetCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  function renderChart() {
    if (widget.loading) {
      return (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (widget.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
          <AlertCircle className="size-5 text-destructive" />
          <p className="text-xs text-destructive line-clamp-3">{widget.error}</p>
        </div>
      );
    }

    if (!widget.result) {
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
          No data. Run the query to see results.
        </div>
      );
    }

    if (widget.type === 'text') {
      return (
        <div className="flex h-full items-center justify-center px-4">
          <p className="text-sm text-center text-muted-foreground">{widget.sql}</p>
        </div>
      );
    }

    const { xColumn, yColumn, kpiFormat, kpiCompareColumn } = widget.config;

    switch (widget.type) {
      case 'bar':
        return <BarChartWidget result={widget.result} xColumn={xColumn} yColumn={yColumn} />;
      case 'line':
        return <LineChartWidget result={widget.result} xColumn={xColumn} yColumn={yColumn} />;
      case 'pie':
        return <PieChartWidget result={widget.result} xColumn={xColumn} yColumn={yColumn} />;
      case 'area':
        return <AreaChartWidget result={widget.result} xColumn={xColumn} yColumn={yColumn} />;
      case 'scatter':
        return <ScatterWidget result={widget.result} xColumn={xColumn} yColumn={yColumn} />;
      case 'kpi':
        return (
          <KPICard
            result={widget.result}
            title={widget.title}
            kpiFormat={kpiFormat}
            kpiCompareColumn={kpiCompareColumn}
          />
        );
      case 'table':
        return <DataTableWidget result={widget.result} />;
      default:
        return (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            Unknown chart type
          </div>
        );
    }
  }

  function handleDeleteClick() {
    if (confirmDelete) {
      onDelete();
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-1.5 bg-muted/30 drag-handle cursor-grab active:cursor-grabbing">
        <h3 className="truncate text-xs font-medium">{widget.title}</h3>
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => { e.stopPropagation(); onRefresh(); }}
                disabled={widget.loading}
              >
                <RefreshCw className={cn('size-3', widget.loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={(e) => { e.stopPropagation(); onEdit(); }}
              >
                <Settings className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit Widget</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={confirmDelete ? 'destructive' : 'ghost'}
                size="icon-xs"
                onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
              >
                <Trash2 className="size-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{confirmDelete ? 'Click again to confirm' : 'Delete'}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      {/* Chart Body */}
      <div className="flex-1 min-h-0 p-2">
        {renderChart()}
      </div>
    </div>
  );
}
