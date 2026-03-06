import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import { RefreshCw, XCircle, Search, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CellValue, QueryResult } from '@/lib/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cellStr(cell: any): string {
  if (!cell || cell.type === 'Null') return '';
  return String(cell.value ?? '');
}

/** Convert a QueryResult into a simple array of key/value maps. */
function resultToMaps(result: QueryResult): Record<string, string>[] {
  const colNames = result.columns.map((c) => c.name.toLowerCase());
  return result.rows.map((row) => {
    const map: Record<string, string> = {};
    for (let i = 0; i < colNames.length; i++) {
      map[colNames[i]] = cellStr(row.cells[i]);
    }
    return map;
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProcessInfo {
  pid: string;
  user: string;
  host: string;
  database: string;
  command: string;
  time: number; // seconds
  query: string;
}

type RefreshInterval = '1' | '2' | '5' | '10' | 'off';

const REFRESH_OPTIONS: { value: RefreshInterval; label: string }[] = [
  { value: '1', label: '1s' },
  { value: '2', label: '2s' },
  { value: '5', label: '5s' },
  { value: '10', label: '10s' },
  { value: 'off', label: 'Off' },
];

// ---------------------------------------------------------------------------
// Parse helpers per DB type
// ---------------------------------------------------------------------------

function parseMysqlProcessList(result: QueryResult): ProcessInfo[] {
  return resultToMaps(result).map((v) => ({
    pid: v['id'] ?? '',
    user: v['user'] ?? '',
    host: v['host'] ?? '',
    database: v['db'] ?? '',
    command: v['command'] ?? '',
    time: parseInt(v['time'] ?? '0', 10) || 0,
    query: v['info'] ?? '',
  }));
}

function parsePostgresProcessList(result: QueryResult): ProcessInfo[] {
  return resultToMaps(result).map((v) => ({
    pid: v['pid'] ?? '',
    user: v['usename'] ?? '',
    host: v['client_addr'] ?? '',
    database: v['datname'] ?? '',
    command: v['state'] ?? '',
    time: parseInt(v['duration_secs'] ?? '0', 10) || 0,
    query: v['query'] ?? '',
  }));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ProcessListProps {
  // no props needed, uses stores
}

export function ProcessList(_props: ProcessListProps) {
  const { activeConnectionId, activeConfig } = useConnectionStore();
  const dbType = activeConfig?.db_type;

  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>('2');
  const [filter, setFilter] = useState('');
  const [killingPid, setKillingPid] = useState<string | null>(null);
  const [confirmKill, setConfirmKill] = useState<{ pid: string; mode: 'process' | 'query' } | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ----- Fetch -----

  const fetchProcesses = useCallback(async () => {
    if (!activeConnectionId || !activeConfig) return;

    if (dbType !== 'mysql' && dbType !== 'postgres') {
      setError(`Process list is not supported for ${dbType}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sql =
        dbType === 'mysql'
          ? 'SHOW FULL PROCESSLIST'
          : `SELECT pid, usename, client_addr, datname, state,
       EXTRACT(EPOCH FROM (now() - query_start))::int as duration_secs,
       query
FROM pg_stat_activity
WHERE pid <> pg_backend_pid()
ORDER BY query_start DESC NULLS LAST`;

      const result = await ipc.executeQuery(activeConnectionId, sql);
      const parsed =
        dbType === 'mysql'
          ? parseMysqlProcessList(result)
          : parsePostgresProcessList(result);
      setProcesses(parsed);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId, activeConfig, dbType]);

  // ----- Auto-refresh -----

  useEffect(() => {
    // Always fetch once immediately
    fetchProcesses();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (refreshInterval !== 'off') {
      const ms = parseInt(refreshInterval, 10) * 1000;
      timerRef.current = setInterval(() => {
        fetchProcesses();
      }, ms);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchProcesses, refreshInterval]);

  // ----- Kill -----

  const handleKill = useCallback(
    async (pid: string, mode: 'process' | 'query') => {
      if (!activeConnectionId || !dbType) return;

      setKillingPid(pid);
      setConfirmKill(null);

      try {
        let sql: string;
        if (dbType === 'mysql') {
          sql = mode === 'query' ? `KILL QUERY ${pid}` : `KILL ${pid}`;
        } else {
          sql =
            mode === 'query'
              ? `SELECT pg_cancel_backend(${pid})`
              : `SELECT pg_terminate_backend(${pid})`;
        }
        await ipc.executeQuery(activeConnectionId, sql);
        // Refresh after kill
        await fetchProcesses();
      } catch (e) {
        setError(`Failed to kill ${mode} ${pid}: ${String(e)}`);
      } finally {
        setKillingPid(null);
      }
    },
    [activeConnectionId, dbType, fetchProcesses],
  );

  // ----- Filter -----

  const lowerFilter = filter.toLowerCase();
  const filtered = processes.filter((p) => {
    if (!lowerFilter) return true;
    return (
      p.user.toLowerCase().includes(lowerFilter) ||
      p.database.toLowerCase().includes(lowerFilter) ||
      p.query.toLowerCase().includes(lowerFilter) ||
      p.pid.toLowerCase().includes(lowerFilter) ||
      p.host.toLowerCase().includes(lowerFilter)
    );
  });

  // ----- Time highlight -----

  function timeClass(seconds: number): string {
    if (seconds > 30) return 'text-red-400 font-semibold';
    if (seconds > 5) return 'text-yellow-400 font-semibold';
    return 'text-muted-foreground';
  }

  // ----- Not connected -----

  if (!activeConnectionId || !activeConfig) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm p-8">
        <AlertTriangle className="size-5" />
        <span>Connect to a database to view server processes.</span>
      </div>
    );
  }

  if (dbType !== 'mysql' && dbType !== 'postgres') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground text-sm p-8">
        <AlertTriangle className="size-5" />
        <span>Process list is not supported for {dbType}.</span>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        {/* ---- Toolbar ---- */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          {/* Search */}
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Filter by user, database, query..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full h-7 pl-7 pr-2 text-xs bg-transparent border border-border rounded-md outline-none focus:border-ring placeholder:text-muted-foreground"
            />
          </div>

          {/* Process count badge */}
          <Badge variant="secondary" className="text-xs tabular-nums">
            {filtered.length} process{filtered.length !== 1 ? 'es' : ''}
          </Badge>

          {/* Refresh interval */}
          <Select
            value={refreshInterval}
            onValueChange={(v) => setRefreshInterval(v as RefreshInterval)}
          >
            <SelectTrigger size="sm" className="w-20 h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REFRESH_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Manual refresh */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => fetchProcesses()}
                disabled={loading}
              >
                <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Refresh now</TooltipContent>
          </Tooltip>
        </div>

        {/* ---- Error banner ---- */}
        {error && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-destructive bg-destructive/10 border-b border-border">
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="truncate">{error}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto shrink-0"
              onClick={() => setError(null)}
            >
              <XCircle className="size-3" />
            </Button>
          </div>
        )}

        {/* ---- Loading state (only on first load, not on refresh) ---- */}
        {loading && processes.length === 0 && (
          <div className="flex items-center justify-center flex-1 gap-2 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin" />
            Loading processes...
          </div>
        )}

        {/* ---- Empty state ---- */}
        {!loading && filtered.length === 0 && processes.length === 0 && (
          <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
            No active processes found.
          </div>
        )}

        {!loading && filtered.length === 0 && processes.length > 0 && (
          <div className="flex items-center justify-center flex-1 text-muted-foreground text-sm">
            No processes match the current filter.
          </div>
        )}

        {/* ---- Table ---- */}
        {filtered.length > 0 && (
          <ScrollArea className="flex-1">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10 bg-background border-b border-border">
                <tr>
                  <th className="text-left font-medium text-muted-foreground px-3 py-1.5 w-16">PID</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-1.5 w-24">User</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-1.5 w-32">Host</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-1.5 w-24">Database</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-1.5 w-24">Command/State</th>
                  <th className="text-right font-medium text-muted-foreground px-3 py-1.5 w-16">Time</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-1.5">Query/Info</th>
                  <th className="text-right font-medium text-muted-foreground px-3 py-1.5 w-28">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((proc) => {
                  const isBeingKilled = killingPid === proc.pid;
                  const isConfirming =
                    confirmKill !== null && confirmKill.pid === proc.pid;

                  return (
                    <tr
                      key={proc.pid}
                      className={cn(
                        'border-b border-border hover:bg-muted/50 transition-colors',
                        proc.time > 30 && 'bg-red-500/5',
                        proc.time > 5 && proc.time <= 30 && 'bg-yellow-500/5',
                      )}
                    >
                      {/* PID */}
                      <td className="px-3 py-1.5 font-mono tabular-nums">{proc.pid}</td>

                      {/* User */}
                      <td className="px-3 py-1.5 truncate max-w-[96px]" title={proc.user}>
                        {proc.user || '-'}
                      </td>

                      {/* Host */}
                      <td className="px-3 py-1.5 truncate max-w-[128px] text-muted-foreground" title={proc.host}>
                        {proc.host || '-'}
                      </td>

                      {/* Database */}
                      <td className="px-3 py-1.5 truncate max-w-[96px]" title={proc.database}>
                        {proc.database || '-'}
                      </td>

                      {/* Command / State */}
                      <td className="px-3 py-1.5">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {proc.command || '-'}
                        </Badge>
                      </td>

                      {/* Time */}
                      <td className={cn('px-3 py-1.5 text-right tabular-nums font-mono', timeClass(proc.time))}>
                        {proc.time}s
                      </td>

                      {/* Query */}
                      <td className="px-3 py-1.5">
                        {proc.query ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block truncate max-w-[400px] font-mono cursor-default">
                                {proc.query}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent
                              side="bottom"
                              className="max-w-md font-mono text-[11px] whitespace-pre-wrap break-all"
                            >
                              {proc.query.length > 500
                                ? proc.query.slice(0, 500) + '...'
                                : proc.query}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-3 py-1.5 text-right">
                        {isBeingKilled ? (
                          <Loader2 className="size-3.5 animate-spin ml-auto text-muted-foreground" />
                        ) : isConfirming ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[10px] text-destructive mr-1">Sure?</span>
                            <Button
                              variant="destructive"
                              size="xs"
                              onClick={() => handleKill(confirmKill!.pid, confirmKill!.mode)}
                            >
                              Yes
                            </Button>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={() => setConfirmKill(null)}
                            >
                              No
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-yellow-500 hover:text-yellow-400 hover:bg-yellow-500/10"
                                  onClick={() =>
                                    setConfirmKill({ pid: proc.pid, mode: 'query' })
                                  }
                                >
                                  <XCircle className="size-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">Kill Query</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  className="text-destructive hover:text-red-400 hover:bg-destructive/10"
                                  onClick={() =>
                                    setConfirmKill({ pid: proc.pid, mode: 'process' })
                                  }
                                >
                                  <AlertTriangle className="size-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">Kill Process</TooltipContent>
                            </Tooltip>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        )}
      </div>
    </TooltipProvider>
  );
}
