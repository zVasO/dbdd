import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import {
  Activity,
  RefreshCw,
  Database,
  Pause,
  Play,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useConnectionStore } from '@/stores/connectionStore';
import { ActiveConnections } from '@/components/health/ActiveConnections';
import { SlowQueryList } from '@/components/health/SlowQueryList';
import { StorageOverview } from '@/components/health/StorageOverview';

const LiveMetrics = lazy(() => import('@/components/health/LiveMetrics').then(m => ({ default: m.LiveMetrics })));
const AlertConfig = lazy(() => import('@/components/health/AlertConfig').then(m => ({ default: m.AlertConfig })));
const AlertHistory = lazy(() => import('@/components/health/AlertHistory').then(m => ({ default: m.AlertHistory })));

const AUTO_REFRESH_INTERVAL_MS = 5000;

export function HealthDashboard() {
  const { activeConnectionId, activeConfig } = useConnectionStore();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    setRefreshTrigger((prev) => prev + 1);
    setLastRefreshAt(Date.now());
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && activeConnectionId) {
      intervalRef.current = setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
  }, [autoRefresh, activeConnectionId, refresh]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!activeConnectionId || !activeConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Database className="size-10 opacity-50" />
        <p className="text-sm">Connect to a database to view health metrics</p>
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
          Health monitoring is available for MySQL and PostgreSQL connections
        </p>
        <Badge variant="outline">{dbType}</Badge>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <Activity className="size-4 text-primary" />
        <h2 className="text-sm font-semibold">Database Health</h2>

        <div className="flex items-center gap-1.5 ml-2">
          <Badge variant="outline" className="text-xs">
            {dbType.toUpperCase()}
          </Badge>
          {activeConfig.name && (
            <Badge variant="secondary" className="text-xs">
              {activeConfig.name}
            </Badge>
          )}
        </div>

        <div className="flex-1" />

        {/* Auto-refresh toggle */}
        <Button
          size="xs"
          variant={autoRefresh ? 'default' : 'outline'}
          onClick={() => setAutoRefresh(!autoRefresh)}
          title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
        >
          {autoRefresh ? (
            <Pause className="size-3" />
          ) : (
            <Play className="size-3" />
          )}
          {autoRefresh ? 'Auto' : 'Paused'}
        </Button>

        {/* Manual refresh */}
        <Button size="xs" variant="outline" onClick={refresh}>
          <RefreshCw
            className={cn(
              'size-3',
              autoRefresh && 'animate-spin',
            )}
            style={autoRefresh ? { animationDuration: '3s' } : undefined}
          />
          Refresh
        </Button>

        <span className="text-[10px] text-muted-foreground">
          {new Date(lastRefreshAt).toLocaleTimeString()}
        </span>
      </div>

      {/* Dashboard content */}
      <Tabs defaultValue="overview" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-2 w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="live">Live Metrics</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="flex-1 overflow-y-auto min-h-0 mt-0">
          <div className="p-4 flex flex-col gap-4">
            <ActiveConnections refreshTrigger={refreshTrigger} />
            <SlowQueryList refreshTrigger={refreshTrigger} />
            <StorageOverview refreshTrigger={refreshTrigger} />
          </div>
        </TabsContent>
        <TabsContent value="live" className="flex-1 overflow-y-auto min-h-0 mt-0">
          <Suspense fallback={<div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Loading...</div>}>
            <LiveMetrics />
          </Suspense>
        </TabsContent>
        <TabsContent value="alerts" className="flex-1 overflow-y-auto min-h-0 mt-0">
          <div className="p-4 flex flex-col gap-4">
            <Suspense fallback={<div className="flex items-center justify-center h-32 text-sm text-muted-foreground">Loading...</div>}>
              <AlertConfig />
              <AlertHistory />
            </Suspense>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
