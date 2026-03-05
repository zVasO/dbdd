import { useState, useEffect, useCallback } from 'react';
import { Users, Loader2, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import type { QueryResult, CellValue } from '@/lib/types';

interface ActiveConnectionsProps {
  refreshTrigger?: number;
}

function cellToString(cell: CellValue): string {
  switch (cell.type) {
    case 'Null':
      return '-';
    case 'Text':
    case 'Uuid':
    case 'DateTime':
    case 'Date':
    case 'Time':
      return cell.value;
    case 'Integer':
    case 'Float':
      return String(cell.value);
    case 'Boolean':
      return cell.value ? 'true' : 'false';
    case 'Json':
      return typeof cell.value === 'string'
        ? cell.value
        : JSON.stringify(cell.value);
    case 'Bytes':
      return cell.value.preview;
    case 'Array':
      return cell.value.map(cellToString).join(', ');
  }
}

interface ProcessInfo {
  id: string;
  user: string;
  database: string;
  command: string;
  time: string;
  state: string;
}

function parseResult(
  result: QueryResult,
  dbType: string,
): ProcessInfo[] {
  const colNames = result.columns.map((c) => c.name.toLowerCase());
  const processes: ProcessInfo[] = [];

  for (const row of result.rows) {
    const values: Record<string, string> = {};
    for (let i = 0; i < colNames.length; i++) {
      values[colNames[i]] = cellToString(row.cells[i]);
    }

    if (dbType === 'mysql') {
      processes.push({
        id: values['id'] ?? '-',
        user: values['user'] ?? '-',
        database: values['db'] ?? '-',
        command: values['command'] ?? '-',
        time: values['time'] ?? '-',
        state: values['state'] ?? '-',
      });
    } else {
      // Postgres
      processes.push({
        id: values['pid'] ?? '-',
        user: values['usename'] ?? '-',
        database: values['datname'] ?? '-',
        command: (values['query'] ?? '-').slice(0, 80),
        time: values['backend_start'] ?? values['query_start'] ?? '-',
        state: values['state'] ?? '-',
      });
    }
  }

  return processes;
}

export function ActiveConnections({ refreshTrigger }: ActiveConnectionsProps) {
  const { activeConnectionId, activeConfig } = useConnectionStore();
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!activeConnectionId || !activeConfig) return;

    const dbType = activeConfig.db_type;
    if (dbType !== 'mysql' && dbType !== 'postgres') {
      setError(`Health monitoring not supported for ${dbType}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sql =
        dbType === 'mysql'
          ? 'SHOW PROCESSLIST'
          : "SELECT pid, usename, datname, query, state, backend_start, query_start FROM pg_stat_activity WHERE state IS NOT NULL";

      const result = await ipc.executeQuery(activeConnectionId, sql);
      setProcesses(parseResult(result, dbType));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId, activeConfig]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-primary" />
          <CardTitle className="text-sm">Active Connections</CardTitle>
          {!loading && processes.length > 0 && (
            <Badge variant="secondary" className="text-xs ml-auto">
              {processes.length}
            </Badge>
          )}
        </div>
        <CardDescription>
          Current database processes and connections.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="flex items-center justify-center py-4 text-muted-foreground text-sm">
            <Loader2 className="size-4 animate-spin mr-2" />
            Loading...
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm py-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {!loading && !error && processes.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No active connections found.
          </p>
        )}

        {!loading && !error && processes.length > 0 && (
          <ScrollArea className="max-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Database</TableHead>
                  <TableHead>Command</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {processes.map((proc, idx) => (
                  <TableRow key={`${proc.id}-${idx}`}>
                    <TableCell className="font-mono text-xs">
                      {proc.id}
                    </TableCell>
                    <TableCell className="text-xs">{proc.user}</TableCell>
                    <TableCell className="text-xs">{proc.database}</TableCell>
                    <TableCell
                      className="text-xs max-w-[200px] truncate"
                      title={proc.command}
                    >
                      {proc.command}
                    </TableCell>
                    <TableCell className="text-xs">{proc.time}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {proc.state}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
