import { useState, useCallback } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Clock,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  XCircle,
} from 'lucide-react';
import { useAlertStore, type ScheduledQuery, type Alert } from '@/stores/alertStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { ScheduledQueryDialog } from './ScheduledQueryDialog';
import { cn } from '@/lib/utils';

export function AlertManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuery, setEditingQuery] = useState<ScheduledQuery | null>(null);

  const handleEdit = useCallback((query: ScheduledQuery) => {
    setEditingQuery(query);
    setDialogOpen(true);
  }, []);

  const handleAdd = useCallback(() => {
    setEditingQuery(null);
    setDialogOpen(true);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <Tabs defaultValue="scheduled" className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <TabsList>
            <TabsTrigger value="scheduled">
              <Clock className="mr-1.5 h-3.5 w-3.5" />
              Scheduled Queries
            </TabsTrigger>
            <TabsTrigger value="history">
              <Bell className="mr-1.5 h-3.5 w-3.5" />
              Alert History
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="scheduled" className="flex-1 overflow-y-auto p-0">
          <ScheduledQueriesTab onAdd={handleAdd} onEdit={handleEdit} />
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-y-auto p-0">
          <AlertHistoryTab />
        </TabsContent>
      </Tabs>

      <ScheduledQueryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editQuery={editingQuery}
      />
    </div>
  );
}

interface ScheduledQueriesTabProps {
  onAdd: () => void;
  onEdit: (query: ScheduledQuery) => void;
}

function ScheduledQueriesTab({ onAdd, onEdit }: ScheduledQueriesTabProps) {
  const scheduledQueries = useAlertStore((s) => s.scheduledQueries);
  const toggleScheduledQuery = useAlertStore((s) => s.toggleScheduledQuery);
  const removeScheduledQuery = useAlertStore((s) => s.removeScheduledQuery);
  const savedConnections = useConnectionStore((s) => s.savedConnections);

  const getConnectionName = (connectionId: string): string => {
    const conn = savedConnections.find((c) => c.config.id === connectionId);
    return conn?.config.name ?? 'Unknown';
  };

  const formatInterval = (ms: number): string => {
    if (ms < 60000) return `${ms / 1000}s`;
    if (ms < 3600000) return `${ms / 60000}m`;
    if (ms < 86400000) return `${ms / 3600000}h`;
    return `${ms / 86400000}d`;
  };

  const getConditionLabel = (condition: ScheduledQuery['condition']): string => {
    switch (condition.type) {
      case 'row_count_exceeds':
        return `Rows > ${condition.threshold ?? 0}`;
      case 'value_exceeds':
        return `${condition.column ?? '?'} > ${condition.threshold ?? 0}`;
      case 'value_below':
        return `${condition.column ?? '?'} < ${condition.threshold ?? 0}`;
      case 'result_changed':
        return 'Result changed';
    }
  };

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm text-muted-foreground">
          {scheduledQueries.length} scheduled {scheduledQueries.length === 1 ? 'query' : 'queries'}
        </span>
        <Button size="sm" onClick={onAdd} className="h-7 text-xs">
          <Plus className="mr-1 h-3 w-3" />
          Add Scheduled Query
        </Button>
      </div>

      {/* List */}
      {scheduledQueries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <Clock className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium">No scheduled queries</p>
            <p className="text-xs text-muted-foreground mt-1">
              Set up queries to run on a schedule and get alerted when conditions are met.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={onAdd}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            Add Your First Query
          </Button>
        </div>
      ) : (
        <div className="flex flex-col">
          {scheduledQueries.map((query, index) => (
            <div key={query.id}>
              {index > 0 && <Separator />}
              <div className="group flex items-start gap-3 px-4 py-3">
                {/* Enable/Disable toggle */}
                <button
                  type="button"
                  className={cn(
                    'mt-0.5 shrink-0 transition-colors',
                    query.enabled
                      ? 'text-green-500 hover:text-green-600'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => toggleScheduledQuery(query.id)}
                  title={query.enabled ? 'Disable' : 'Enable'}
                >
                  {query.enabled ? (
                    <Bell className="h-4 w-4" />
                  ) : (
                    <BellOff className="h-4 w-4" />
                  )}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{query.name}</p>
                    <Badge
                      variant={query.enabled ? 'default' : 'secondary'}
                      className="text-[9px] h-4 px-1 shrink-0"
                    >
                      {query.enabled ? 'Active' : 'Paused'}
                    </Badge>
                  </div>

                  <p className="mt-0.5 text-xs text-muted-foreground font-mono truncate">
                    {query.sql.substring(0, 80)}
                  </p>

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                      <Clock className="mr-0.5 h-2.5 w-2.5" />
                      {formatInterval(query.intervalMs)}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                      {getConditionLabel(query.condition)}
                    </Badge>
                    <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                      {getConnectionName(query.connectionId)}
                    </Badge>
                    {query.lastRunAt && (
                      <span className="text-[10px] text-muted-foreground">
                        Last run: {new Date(query.lastRunAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onEdit(query)}
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => removeScheduledQuery(query.id)}
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AlertHistoryTab() {
  const alerts = useAlertStore((s) => s.alerts);
  const markAsRead = useAlertStore((s) => s.markAsRead);
  const markAllAsRead = useAlertStore((s) => s.markAllAsRead);
  const clearAlerts = useAlertStore((s) => s.clearAlerts);

  const sortedAlerts = [...alerts].sort((a, b) => b.timestamp - a.timestamp);
  const unreadCount = alerts.filter((a) => !a.read).length;

  const getSeverityIcon = (severity: Alert['severity']) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="h-4 w-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'info':
        return <Info className="h-4 w-4 text-blue-500" />;
    }
  };

  const getSeverityBg = (severity: Alert['severity'], read: boolean): string => {
    if (read) return '';
    switch (severity) {
      case 'critical':
        return 'bg-red-500/5';
      case 'warning':
        return 'bg-yellow-500/5';
      case 'info':
        return 'bg-blue-500/5';
    }
  };

  const formatTimestamp = (ts: number): string => {
    const date = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm text-muted-foreground">
          {unreadCount > 0 ? `${unreadCount} unread` : 'No unread alerts'}
        </span>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markAllAsRead}>
              <CheckCheck className="mr-1 h-3 w-3" />
              Mark All Read
            </Button>
          )}
          {alerts.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={clearAlerts}
            >
              <Trash2 className="mr-1 h-3 w-3" />
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* List */}
      {sortedAlerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
          <CheckCircle className="h-10 w-10 text-muted-foreground/30" />
          <div>
            <p className="text-sm font-medium">No alerts</p>
            <p className="text-xs text-muted-foreground mt-1">
              Alerts will appear here when scheduled query conditions are met.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          {sortedAlerts.map((alert, index) => (
            <div key={alert.id}>
              {index > 0 && <Separator />}
              <div
                className={cn(
                  'group flex items-start gap-3 px-4 py-3 transition-colors',
                  getSeverityBg(alert.severity, alert.read),
                )}
              >
                {/* Severity icon */}
                <div className="mt-0.5 shrink-0">
                  {getSeverityIcon(alert.severity)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn('text-sm', !alert.read && 'font-semibold')}>
                      {alert.queryName}
                    </p>
                    <Badge
                      variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}
                      className="text-[9px] h-4 px-1 shrink-0"
                    >
                      {alert.severity}
                    </Badge>
                    {!alert.read && (
                      <span className="h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                  </div>

                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {alert.message}
                  </p>

                  <span className="mt-1 text-[10px] text-muted-foreground">
                    {formatTimestamp(alert.timestamp)}
                  </span>
                </div>

                {/* Acknowledge */}
                {!alert.read && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={() => markAsRead(alert.id)}
                    title="Mark as read"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
