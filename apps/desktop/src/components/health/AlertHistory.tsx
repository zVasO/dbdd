import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Trash2,
  CheckCheck,
  Bell,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useMonitoringStore } from '@/stores/monitoringStore';

const METRIC_LABELS: Record<string, string> = {
  queries_per_sec: 'Queries/sec',
  active_connections: 'Active Connections',
  cache_hit_ratio: 'Cache Hit Ratio',
  slow_queries: 'Slow Queries',
};

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatValue(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return value.toFixed(value % 1 === 0 ? 0 : 1);
}

export function AlertHistory() {
  const { alertHistory, alertRules, acknowledgeAlert, clearAlerts } =
    useMonitoringStore();

  const unacknowledgedCount = alertHistory.filter((a) => !a.acknowledged).length;

  const acknowledgeAll = () => {
    for (const alert of alertHistory) {
      if (!alert.acknowledged) {
        acknowledgeAlert(alert.id);
      }
    }
  };

  const getMetricLabel = (ruleId: string): string => {
    const rule = alertRules.find((r) => r.id === ruleId);
    if (!rule) return 'Unknown';
    return METRIC_LABELS[rule.metric] ?? rule.metric;
  };

  const isCritical = (ruleId: string): boolean => {
    const rule = alertRules.find((r) => r.id === ruleId);
    if (!rule) return false;
    // Consider it critical if cache hit ratio is low or operator is > for queries
    return (
      (rule.metric === 'cache_hit_ratio' && rule.operator === '<') ||
      (rule.metric === 'slow_queries' && rule.operator === '>') ||
      (rule.metric === 'queries_per_sec' &&
        rule.operator === '>' &&
        rule.threshold >= 1000)
    );
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Bell className="size-4 text-primary" />
        <h3 className="text-sm font-semibold">Alert History</h3>
        {unacknowledgedCount > 0 && (
          <Badge variant="destructive" className="text-xs">
            {unacknowledgedCount} new
          </Badge>
        )}
        <div className="flex-1" />
        {alertHistory.length > 0 && (
          <div className="flex items-center gap-1">
            <Button
              size="xs"
              variant="outline"
              onClick={acknowledgeAll}
              disabled={unacknowledgedCount === 0}
            >
              <CheckCheck className="size-3" />
              Mark All Read
            </Button>
            <Button size="xs" variant="outline" onClick={clearAlerts}>
              <Trash2 className="size-3" />
              Clear All
            </Button>
          </div>
        )}
      </div>

      {/* Alert List */}
      {alertHistory.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-muted-foreground gap-2">
          <CheckCircle2 className="size-8 opacity-50" />
          <p className="text-sm">No alerts triggered</p>
          <p className="text-xs">Alerts will appear here when metric thresholds are crossed.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto">
          {alertHistory.map((alert) => {
            const critical = isCritical(alert.ruleId);
            const metricLabel = getMetricLabel(alert.ruleId);

            return (
              <div
                key={alert.id}
                className={cn(
                  'flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors',
                  !alert.acknowledged && 'border-l-[3px] border-l-blue-500 bg-blue-500/5',
                  alert.acknowledged && 'opacity-70',
                )}
              >
                {/* Icon */}
                <div className="shrink-0 mt-0.5">
                  {critical ? (
                    <AlertCircle className="size-4 text-destructive" />
                  ) : (
                    <AlertTriangle className="size-4 text-yellow-500" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs">{alert.ruleName}</span>
                    {critical && (
                      <Badge variant="destructive" className="text-[10px] px-1 py-0">
                        Critical
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {metricLabel} exceeded {formatValue(alert.threshold)}: current value{' '}
                    <span className="font-mono font-medium text-foreground">
                      {formatValue(alert.value)}
                    </span>
                  </p>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTimestamp(alert.timestamp)}
                  </span>
                </div>

                {/* Acknowledge */}
                {!alert.acknowledged && (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => acknowledgeAlert(alert.id)}
                    title="Acknowledge"
                    className="shrink-0"
                  >
                    <CheckCircle2 className="size-3.5" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
