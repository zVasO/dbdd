import { useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Play, Loader2 } from 'lucide-react';
import { useConnectionStore } from '@/stores/connectionStore';
import { useAlertStore, type ScheduledQuery } from '@/stores/alertStore';
import { ipc } from '@/lib/ipc';

interface ScheduledQueryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editQuery?: ScheduledQuery | null;
}

const INTERVAL_OPTIONS = [
  { label: '1 minute', value: 60000 },
  { label: '5 minutes', value: 300000 },
  { label: '15 minutes', value: 900000 },
  { label: '1 hour', value: 3600000 },
  { label: '6 hours', value: 21600000 },
  { label: 'Daily', value: 86400000 },
];

const CONDITION_TYPES = [
  { label: 'Row count exceeds', value: 'row_count_exceeds' as const },
  { label: 'Value exceeds', value: 'value_exceeds' as const },
  { label: 'Value below', value: 'value_below' as const },
  { label: 'Result changed', value: 'result_changed' as const },
];

export function ScheduledQueryDialog({
  open,
  onOpenChange,
  editQuery,
}: ScheduledQueryDialogProps) {
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const addScheduledQuery = useAlertStore((s) => s.addScheduledQuery);
  const updateScheduledQuery = useAlertStore((s) => s.updateScheduledQuery);

  const [name, setName] = useState(editQuery?.name ?? '');
  const [sql, setSql] = useState(editQuery?.sql ?? '');
  const [connectionId, setConnectionId] = useState(editQuery?.connectionId ?? '');
  const [intervalMs, setIntervalMs] = useState(String(editQuery?.intervalMs ?? 300000));
  const [conditionType, setConditionType] = useState<ScheduledQuery['condition']['type']>(
    editQuery?.condition.type ?? 'row_count_exceeds',
  );
  const [threshold, setThreshold] = useState(String(editQuery?.condition.threshold ?? 0));
  const [column, setColumn] = useState(editQuery?.condition.column ?? '');

  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const showThreshold = conditionType !== 'result_changed';
  const showColumn = conditionType === 'value_exceeds' || conditionType === 'value_below';

  const handleTestNow = useCallback(async () => {
    if (!connectionId || !sql.trim()) return;

    setTestRunning(true);
    setTestResult(null);
    setTestError(null);

    try {
      const result = await ipc.executeQuery(connectionId, sql);
      setTestResult(
        `${result.rows.length} row${result.rows.length !== 1 ? 's' : ''} returned, ` +
        `${result.columns.length} column${result.columns.length !== 1 ? 's' : ''}, ` +
        `${result.execution_time_ms}ms`,
      );
    } catch (e) {
      setTestError(String(e));
    } finally {
      setTestRunning(false);
    }
  }, [connectionId, sql]);

  const handleSave = useCallback(() => {
    if (!name.trim() || !sql.trim() || !connectionId) return;

    const condition: ScheduledQuery['condition'] = {
      type: conditionType,
    };
    if (showThreshold) {
      condition.threshold = Number(threshold);
    }
    if (showColumn) {
      condition.column = column;
    }

    if (editQuery) {
      updateScheduledQuery(editQuery.id, {
        name: name.trim(),
        sql: sql.trim(),
        connectionId,
        intervalMs: Number(intervalMs),
        condition,
      });
    } else {
      addScheduledQuery({
        name: name.trim(),
        sql: sql.trim(),
        connectionId,
        intervalMs: Number(intervalMs),
        condition,
        enabled: true,
      });
    }

    onOpenChange(false);
  }, [
    name, sql, connectionId, intervalMs, conditionType, threshold, column,
    showThreshold, showColumn, editQuery, addScheduledQuery, updateScheduledQuery, onOpenChange,
  ]);

  const isValid = name.trim() && sql.trim() && connectionId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{editQuery ? 'Edit Scheduled Query' : 'New Scheduled Query'}</DialogTitle>
          <DialogDescription>
            Set up a query to run on a schedule and alert you when conditions are met.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sq-name" className="text-xs">Name</Label>
            <Input
              id="sq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Monitor failed jobs"
              className="h-8 text-sm"
            />
          </div>

          {/* SQL */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sq-sql" className="text-xs">SQL Query</Label>
            <textarea
              id="sq-sql"
              value={sql}
              onChange={(e) => setSql(e.target.value)}
              placeholder="SELECT COUNT(*) as cnt FROM failed_jobs WHERE created_at > NOW() - INTERVAL 1 HOUR"
              className="min-h-[80px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
              rows={3}
            />
          </div>

          {/* Connection */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Connection</Label>
            <Select value={connectionId} onValueChange={setConnectionId}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue placeholder="Select a connection" />
              </SelectTrigger>
              <SelectContent>
                {savedConnections.map((conn) => (
                  <SelectItem key={conn.config.id} value={conn.config.id}>
                    <span className="flex items-center gap-2">
                      {conn.config.name}
                      <Badge variant="secondary" className="text-[9px] h-4 px-1">
                        {conn.config.db_type}
                      </Badge>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Interval */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Check Interval</Label>
            <Select value={intervalMs} onValueChange={setIntervalMs}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Condition */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Alert Condition</Label>
            <Select value={conditionType} onValueChange={(v) => setConditionType(v as ScheduledQuery['condition']['type'])}>
              <SelectTrigger className="w-full h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_TYPES.map((ct) => (
                  <SelectItem key={ct.value} value={ct.value}>
                    {ct.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Threshold */}
          {showThreshold && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sq-threshold" className="text-xs">Threshold</Label>
              <Input
                id="sq-threshold"
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="0"
                className="h-8 text-sm"
              />
            </div>
          )}

          {/* Column */}
          {showColumn && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sq-column" className="text-xs">Column Name</Label>
              <Input
                id="sq-column"
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                placeholder="e.g., count, avg_value"
                className="h-8 text-sm"
              />
            </div>
          )}

          {/* Test button */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTestNow}
              disabled={!connectionId || !sql.trim() || testRunning}
            >
              {testRunning ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="mr-1.5 h-3.5 w-3.5" />
              )}
              Test Now
            </Button>
            {testResult && (
              <span className="text-xs text-green-600 dark:text-green-400">{testResult}</span>
            )}
            {testError && (
              <span className="text-xs text-destructive truncate max-w-[250px]" title={testError}>
                {testError}
              </span>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!isValid}>
            {editQuery ? 'Update' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
