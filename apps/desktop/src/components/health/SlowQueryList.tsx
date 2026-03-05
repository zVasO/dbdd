import { useState, useEffect, useCallback } from 'react';
import { Turtle, Loader2, AlertTriangle } from 'lucide-react';
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
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import type { QueryResult, CellValue } from '@/lib/types';

interface SlowQueryListProps {
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

interface SlowQuery {
  duration: string;
  query: string;
  user: string;
  database: string;
}

function parseResult(result: QueryResult, dbType: string): SlowQuery[] {
  const colNames = result.columns.map((c) => c.name.toLowerCase());
  const queries: SlowQuery[] = [];

  for (const row of result.rows) {
    const values: Record<string, string> = {};
    for (let i = 0; i < colNames.length; i++) {
      values[colNames[i]] = cellToString(row.cells[i]);
    }

    if (dbType === 'mysql') {
      queries.push({
        duration: `${values['time'] ?? '?'}s`,
        query: (values['info'] ?? '-').slice(0, 120),
        user: values['user'] ?? '-',
        database: values['db'] ?? '-',
      });
    } else {
      // Postgres
      queries.push({
        duration: values['duration'] ?? '-',
        query: (values['query'] ?? '-').slice(0, 120),
        user: values['usename'] ?? values['user'] ?? '-',
        database: values['datname'] ?? values['database'] ?? '-',
      });
    }
  }

  return queries;
}

export function SlowQueryList({ refreshTrigger }: SlowQueryListProps) {
  const { activeConnectionId, activeConfig } = useConnectionStore();
  const [queries, setQueries] = useState<SlowQuery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!activeConnectionId || !activeConfig) return;

    const dbType = activeConfig.db_type;
    if (dbType !== 'mysql' && dbType !== 'postgres') {
      setError(`Slow query monitoring not supported for ${dbType}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sql =
        dbType === 'mysql'
          ? 'SELECT * FROM information_schema.processlist WHERE TIME > 1 ORDER BY TIME DESC'
          : "SELECT pid, usename, datname, now() - pg_stat_activity.query_start AS duration, query, state FROM pg_stat_activity WHERE state != 'idle' AND (now() - pg_stat_activity.query_start) > interval '1 second' ORDER BY duration DESC";

      const result = await ipc.executeQuery(activeConnectionId, sql);
      setQueries(parseResult(result, dbType));
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
          <Turtle className="size-4 text-yellow-500" />
          <CardTitle className="text-sm">Slow Queries</CardTitle>
          {!loading && queries.length > 0 && (
            <Badge variant="destructive" className="text-xs ml-auto">
              {queries.length}
            </Badge>
          )}
        </div>
        <CardDescription>
          Queries running longer than 1 second.
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

        {!loading && !error && queries.length === 0 && (
          <div className="text-sm text-center py-4">
            <p className="text-green-600 dark:text-green-400 font-medium">
              No slow queries detected
            </p>
            <p className="text-muted-foreground text-xs mt-1">
              All queries are running within normal parameters.
            </p>
          </div>
        )}

        {!loading && !error && queries.length > 0 && (
          <div className="max-h-[300px] overflow-y-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Duration</TableHead>
                  <TableHead>Query</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Database</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queries.map((q, idx) => (
                  <TableRow key={idx}>
                    <TableCell>
                      <Badge variant="destructive" className="text-[10px]">
                        {q.duration}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className="text-xs font-mono max-w-[300px] truncate"
                      title={q.query}
                    >
                      {q.query}
                    </TableCell>
                    <TableCell className="text-xs">{q.user}</TableCell>
                    <TableCell className="text-xs">{q.database}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
