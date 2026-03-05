import { useEffect, useMemo } from 'react';
import { Activity, Database, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConnectionStore } from '@/stores/connectionStore';
import { useMonitoringStore } from '@/stores/monitoringStore';
import { MetricChart } from '@/components/health/MetricChart';

const DISPLAY_POINTS = 60; // 2 minute window at 2s polling

interface MetricConfig {
  key: string;
  title: string;
  color: string;
  unit: string;
}

const METRIC_CONFIGS: MetricConfig[] = [
  { key: 'queries_per_sec', title: 'Queries/sec', color: '#3b82f6', unit: '/s' },
  { key: 'active_connections', title: 'Active Connections', color: '#22c55e', unit: '' },
  { key: 'cache_hit_ratio', title: 'Cache Hit Ratio', color: '#a855f7', unit: '%' },
  { key: 'slow_queries', title: 'Slow Queries', color: '#ef4444', unit: '' },
];

export function LiveMetrics() {
  const { activeConnectionId, activeConfig } = useConnectionStore();
  const { metrics, isPolling, startPolling, stopPolling } = useMonitoringStore();

  // Start polling when component mounts with a valid connection
  useEffect(() => {
    if (activeConnectionId && activeConfig) {
      const dbType = activeConfig.db_type;
      if (dbType === 'mysql' || dbType === 'postgres') {
        startPolling(activeConnectionId, dbType);
      }
    }
    return () => {
      stopPolling();
    };
  }, [activeConnectionId, activeConfig, startPolling, stopPolling]);

  // Memoize trimmed data for display
  const chartData = useMemo(() => {
    const result: Record<string, typeof metrics[string]> = {};
    for (const cfg of METRIC_CONFIGS) {
      const points = metrics[cfg.key] ?? [];
      result[cfg.key] = points.slice(-DISPLAY_POINTS);
    }
    return result;
  }, [metrics]);

  if (!activeConnectionId || !activeConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Database className="size-10 opacity-50" />
        <p className="text-sm">Connect to a database to view live metrics</p>
      </div>
    );
  }

  const dbType = activeConfig.db_type;
  const isSupported = dbType === 'mysql' || dbType === 'postgres';

  if (!isSupported) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Database className="size-10 opacity-50" />
        <p className="text-sm">
          Live metrics are available for MySQL and PostgreSQL connections
        </p>
        <Badge variant="outline">{dbType}</Badge>
      </div>
    );
  }

  const handleToggle = () => {
    if (isPolling) {
      stopPolling();
    } else if (activeConnectionId) {
      startPolling(activeConnectionId, dbType);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Activity className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Live Metrics</h3>
        <div
          className={cn(
            'size-2 rounded-full',
            isPolling ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/40',
          )}
        />
        <span className="text-[10px] text-muted-foreground">
          {isPolling ? 'Polling every 2s' : 'Paused'}
        </span>
        <div className="flex-1" />
        <Button size="xs" variant="outline" onClick={handleToggle}>
          {isPolling ? (
            <Pause className="size-3" />
          ) : (
            <Play className="size-3" />
          )}
          {isPolling ? 'Pause' : 'Resume'}
        </Button>
      </div>

      {/* 2x2 grid of charts */}
      <div className="grid grid-cols-2 gap-3">
        {METRIC_CONFIGS.map((cfg) => (
          <MetricChart
            key={cfg.key}
            title={cfg.title}
            data={chartData[cfg.key] ?? []}
            color={cfg.color}
            unit={cfg.unit}
          />
        ))}
      </div>
    </div>
  );
}
