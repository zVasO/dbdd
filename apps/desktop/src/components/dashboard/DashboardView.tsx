import { useState, useCallback, useEffect, useRef } from 'react';
import GridLayout from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import {
  Plus, RefreshCw, LayoutDashboard,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboardStore';
import type { DashboardWidget } from '@/stores/dashboardStore';
import type { Layout, LayoutItem } from 'react-grid-layout';
import { WidgetCard } from './WidgetCard';
import { WidgetConfigDialog } from './WidgetConfigDialog';
import { DashboardManager } from './DashboardManager';

interface DashboardViewProps {
  connectionId: string | null;
}

export function DashboardView({ connectionId }: DashboardViewProps) {
  const dashboards = useDashboardStore((s) => s.dashboards);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const addWidget = useDashboardStore((s) => s.addWidget);
  const updateWidget = useDashboardStore((s) => s.updateWidget);
  const removeWidget = useDashboardStore((s) => s.removeWidget);
  const updateLayout = useDashboardStore((s) => s.updateLayout);
  const executeWidgetQuery = useDashboardStore((s) => s.executeWidgetQuery);
  const executeAllWidgets = useDashboardStore((s) => s.executeAllWidgets);

  const dashboard = dashboards.find((d) => d.id === activeDashboardId);

  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | undefined>(undefined);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1200);
  const containerRef = useRef<HTMLDivElement>(null);

  // Measure container width for the grid
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-refresh timers
  useEffect(() => {
    if (!dashboard || !connectionId) return;

    const timers: ReturnType<typeof setInterval>[] = [];

    for (const widget of dashboard.widgets) {
      const interval = widget.config.refreshInterval;
      if (interval && interval > 0) {
        const timer = setInterval(() => {
          executeWidgetQuery(dashboard.id, widget.id, connectionId);
        }, interval * 1000);
        timers.push(timer);
      }
    }

    return () => {
      timers.forEach(clearInterval);
    };
  }, [dashboard, connectionId, executeWidgetQuery]);

  const handleLayoutChange = useCallback(
    (newLayout: Layout) => {
      if (!dashboard) return;
      updateLayout(dashboard.id, [...newLayout]);
    },
    [dashboard, updateLayout],
  );

  const handleAddWidget = useCallback(() => {
    setEditingWidget(undefined);
    setConfigDialogOpen(true);
  }, []);

  const handleEditWidget = useCallback((widget: DashboardWidget) => {
    setEditingWidget(widget);
    setConfigDialogOpen(true);
  }, []);

  const handleSaveWidget = useCallback(
    (widgetData: Omit<DashboardWidget, 'id'>) => {
      if (!dashboard) return;
      if (editingWidget) {
        updateWidget(dashboard.id, editingWidget.id, widgetData);
      } else {
        const widgetId = addWidget(dashboard.id, widgetData);
        // Auto-execute the query if there's a connection and SQL
        if (connectionId && widgetData.sql.trim()) {
          executeWidgetQuery(dashboard.id, widgetId, connectionId);
        }
      }
    },
    [dashboard, editingWidget, addWidget, updateWidget, connectionId, executeWidgetQuery],
  );

  const handleRefreshWidget = useCallback(
    (widgetId: string) => {
      if (!dashboard || !connectionId) return;
      executeWidgetQuery(dashboard.id, widgetId, connectionId);
    },
    [dashboard, connectionId, executeWidgetQuery],
  );

  const handleDeleteWidget = useCallback(
    (widgetId: string) => {
      if (!dashboard) return;
      removeWidget(dashboard.id, widgetId);
    },
    [dashboard, removeWidget],
  );

  const handleRefreshAll = useCallback(async () => {
    if (!dashboard || !connectionId) return;
    setRefreshingAll(true);
    await executeAllWidgets(dashboard.id, connectionId);
    setRefreshingAll(false);
  }, [dashboard, connectionId, executeAllWidgets]);

  // Empty state: no active dashboard
  if (!dashboard) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
        <LayoutDashboard className="size-12 opacity-30" />
        <div className="text-center">
          <p className="text-sm font-medium">No dashboard selected</p>
          <p className="mt-1 text-xs">
            Create or select a dashboard to get started.
          </p>
        </div>
        <DashboardManager />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b px-4 py-2 bg-background shrink-0">
        <div className="flex items-center gap-2">
          <DashboardManager />
        </div>
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRefreshAll}
                disabled={refreshingAll || !connectionId}
              >
                <RefreshCw className={cn('size-3.5', refreshingAll && 'animate-spin')} />
                Refresh All
              </Button>
            </TooltipTrigger>
            <TooltipContent>Re-execute all widget queries</TooltipContent>
          </Tooltip>
          <Button size="sm" onClick={handleAddWidget}>
            <Plus className="size-3.5" />
            Add Widget
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div ref={containerRef} className="flex-1 overflow-auto p-4">
        {dashboard.widgets.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <LayoutDashboard className="size-10 opacity-30" />
            <div className="text-center">
              <p className="text-sm font-medium">Dashboard is empty</p>
              <p className="mt-1 text-xs">
                Add widgets to visualize your query results.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={handleAddWidget}>
              <Plus className="size-3.5" />
              Add Widget
            </Button>
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={dashboard.layout}
            width={containerWidth}
            gridConfig={{
              cols: 12,
              rowHeight: 80,
              margin: [12, 12] as const,
              containerPadding: [0, 0] as const,
            }}
            dragConfig={{
              enabled: true,
              handle: '.drag-handle',
            }}
            resizeConfig={{
              enabled: true,
            }}
            onLayoutChange={handleLayoutChange}
          >
            {dashboard.widgets.map((widget) => (
              <div key={widget.id}>
                <WidgetCard
                  widget={widget}
                  onRefresh={() => handleRefreshWidget(widget.id)}
                  onEdit={() => handleEditWidget(widget)}
                  onDelete={() => handleDeleteWidget(widget.id)}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      {/* Config Dialog */}
      <WidgetConfigDialog
        open={configDialogOpen}
        onOpenChange={setConfigDialogOpen}
        connectionId={connectionId}
        widget={editingWidget}
        onSave={handleSaveWidget}
      />
    </div>
  );
}
