import { useState, useEffect, useCallback, useMemo } from 'react';
import { HardDrive, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import type { QueryResult, CellValue } from '@/lib/types';

interface StorageOverviewProps {
  refreshTrigger?: number;
}

function cellToNumber(cell: CellValue): number {
  switch (cell.type) {
    case 'Integer':
    case 'Float':
      return cell.value;
    case 'Text': {
      const parsed = parseFloat(cell.value);
      return isNaN(parsed) ? 0 : parsed;
    }
    default:
      return 0;
  }
}

function cellToString(cell: CellValue): string {
  switch (cell.type) {
    case 'Null':
      return '-';
    case 'Text':
      return cell.value;
    case 'Integer':
    case 'Float':
      return String(cell.value);
    default:
      return '-';
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface TableStorage {
  name: string;
  rowCount: number;
  totalSize: number;
  dataSize?: number;
  indexSize?: number;
}

function parseResult(result: QueryResult, dbType: string): TableStorage[] {
  const colNames = result.columns.map((c) => c.name.toLowerCase());
  const tables: TableStorage[] = [];

  for (const row of result.rows) {
    const getCol = (name: string): CellValue | null => {
      const idx = colNames.indexOf(name);
      return idx >= 0 ? row.cells[idx] : null;
    };

    if (dbType === 'mysql') {
      const nameCell = getCol('table_name');
      const rowsCell = getCol('table_rows');
      const dataCell = getCol('data_length');
      const indexCell = getCol('index_length');

      const dataSize = dataCell ? cellToNumber(dataCell) : 0;
      const indexSize = indexCell ? cellToNumber(indexCell) : 0;

      tables.push({
        name: nameCell ? cellToString(nameCell) : 'unknown',
        rowCount: rowsCell ? cellToNumber(rowsCell) : 0,
        totalSize: dataSize + indexSize,
        dataSize,
        indexSize,
      });
    } else {
      // Postgres
      const nameCell = getCol('relname');
      const rowsCell = getCol('n_live_tup');
      const sizeCell = getCol('total_size');

      tables.push({
        name: nameCell ? cellToString(nameCell) : 'unknown',
        rowCount: rowsCell ? cellToNumber(rowsCell) : 0,
        totalSize: sizeCell ? cellToNumber(sizeCell) : 0,
      });
    }
  }

  return tables.sort((a, b) => b.totalSize - a.totalSize);
}

const BAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-violet-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-orange-500',
  'bg-lime-500',
];

export function StorageOverview({ refreshTrigger }: StorageOverviewProps) {
  const { activeConnectionId, activeConfig } = useConnectionStore();
  const [tables, setTables] = useState<TableStorage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!activeConnectionId || !activeConfig) return;

    const dbType = activeConfig.db_type;
    if (dbType !== 'mysql' && dbType !== 'postgres') {
      setError(`Storage monitoring not supported for ${dbType}`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const sql =
        dbType === 'mysql'
          ? 'SELECT table_name, table_rows, data_length, index_length FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY data_length DESC'
          : 'SELECT relname, n_live_tup, pg_total_relation_size(relid) as total_size FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC';

      const result = await ipc.executeQuery(activeConnectionId, sql);
      setTables(parseResult(result, dbType));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId, activeConfig]);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshTrigger]);

  const totalDbSize = useMemo(
    () => tables.reduce((sum, t) => sum + t.totalSize, 0),
    [tables],
  );

  const maxSize = useMemo(
    () => (tables.length > 0 ? tables[0].totalSize : 0),
    [tables],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <HardDrive className="size-4 text-primary" />
          <CardTitle className="text-sm">Storage Overview</CardTitle>
          {!loading && totalDbSize > 0 && (
            <Badge variant="secondary" className="text-xs ml-auto">
              Total: {formatBytes(totalDbSize)}
            </Badge>
          )}
        </div>
        <CardDescription>
          Table and index sizes across the database.
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

        {!loading && !error && tables.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No tables found in the database.
          </p>
        )}

        {!loading && !error && tables.length > 0 && (
          <div className="max-h-[350px] overflow-y-auto">
            <div className="flex flex-col gap-2">
              {tables.map((table, idx) => {
                const pct =
                  maxSize > 0
                    ? Math.max((table.totalSize / maxSize) * 100, 1)
                    : 0;
                const barColor = BAR_COLORS[idx % BAR_COLORS.length];

                return (
                  <div key={table.name} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono font-medium truncate max-w-[60%]">
                        {table.name}
                      </span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">
                          {table.rowCount.toLocaleString()} rows
                        </span>
                        <span className="font-medium">
                          {formatBytes(table.totalSize)}
                        </span>
                      </div>
                    </div>

                    {/* Bar */}
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full transition-all', barColor)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {/* Data/index breakdown for MySQL */}
                    {table.dataSize !== undefined &&
                      table.indexSize !== undefined && (
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                          <span>Data: {formatBytes(table.dataSize)}</span>
                          <span>Index: {formatBytes(table.indexSize)}</span>
                        </div>
                      )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
