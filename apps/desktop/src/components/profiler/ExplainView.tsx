import { useState, useCallback } from 'react';
import { Play, Loader2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConnectionStore } from '@/stores/connectionStore';
import { ipc } from '@/lib/ipc';
import { PlanNodeCard, type PlanNode } from '@/components/profiler/PlanNodeCard';
import type { QueryResult, CellValue } from '@/lib/types';

interface ExplainViewProps {
  query: string;
}

function cellToString(cell: CellValue): string {
  switch (cell.type) {
    case 'Null':
      return '';
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

// ------------ Postgres JSON parser ------------

interface PgPlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Alias'?: string;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Total Cost'?: number;
  'Startup Cost'?: number;
  'Actual Total Time'?: number;
  'Actual Startup Time'?: number;
  'Index Name'?: string;
  'Filter'?: string;
  'Join Type'?: string;
  'Hash Cond'?: string;
  'Sort Key'?: string[];
  Plans?: PgPlanNode[];
  [key: string]: unknown;
}

function parsePgPlanNode(pg: PgPlanNode, index: number = 0): PlanNode {
  const extra: Record<string, string> = {};

  if (pg['Index Name']) extra['Index'] = pg['Index Name'];
  if (pg['Filter']) extra['Filter'] = pg['Filter'];
  if (pg['Join Type']) extra['Join'] = pg['Join Type'];
  if (pg['Hash Cond']) extra['Hash Cond'] = pg['Hash Cond'];
  if (pg['Sort Key']) extra['Sort'] = pg['Sort Key'].join(', ');

  return {
    id: `pg-${index}-${pg['Node Type']}`,
    operation: pg['Node Type'],
    table: pg['Relation Name'] ?? null,
    rowsEstimated: pg['Plan Rows'] ?? null,
    rowsActual: pg['Actual Rows'] ?? null,
    cost: pg['Total Cost'] ?? null,
    timeMs: pg['Actual Total Time'] ?? null,
    extra,
    children: (pg.Plans ?? []).map((child, i) =>
      parsePgPlanNode(child, index * 100 + i + 1),
    ),
  };
}

function parsePostgresExplain(result: QueryResult): PlanNode | null {
  try {
    // Postgres EXPLAIN (FORMAT JSON) returns a single row/column with the JSON plan
    let jsonStr = '';

    if (result.rows.length > 0 && result.rows[0].cells.length > 0) {
      const cell = result.rows[0].cells[0];
      if (cell.type === 'Json') {
        const arr = cell.value as PgPlanNode[];
        if (Array.isArray(arr) && arr.length > 0 && arr[0].Plan) {
          return parsePgPlanNode(arr[0].Plan as PgPlanNode);
        }
        // Some versions return the plan at top level
        if (Array.isArray(arr) && arr.length > 0 && arr[0]['Node Type']) {
          return parsePgPlanNode(arr[0]);
        }
      }
      jsonStr = cellToString(cell);
    } else {
      // Concatenate all rows
      jsonStr = result.rows.map((r) => r.cells.map(cellToString).join('')).join('');
    }

    if (jsonStr) {
      const parsed = JSON.parse(jsonStr);
      const plan = Array.isArray(parsed) ? parsed[0] : parsed;
      const pgPlan = plan.Plan ?? plan;
      return parsePgPlanNode(pgPlan);
    }
  } catch {
    // Fall through to return null
  }
  return null;
}

// ------------ MySQL text parser ------------

function parseMySQLExplain(result: QueryResult): PlanNode {
  const children: PlanNode[] = [];

  for (let rowIdx = 0; rowIdx < result.rows.length; rowIdx++) {
    const row = result.rows[rowIdx];
    const values: Record<string, string> = {};
    for (let colIdx = 0; colIdx < result.columns.length; colIdx++) {
      const colName = result.columns[colIdx].name.toLowerCase();
      values[colName] = cellToString(row.cells[colIdx]);
    }

    const extra: Record<string, string> = {};
    if (values['key']) extra['Key'] = values['key'];
    if (values['extra']) extra['Extra'] = values['extra'];
    if (values['type']) extra['Access'] = values['type'];

    const rowsVal = values['rows'] ? parseInt(values['rows'], 10) : null;

    children.push({
      id: `mysql-${rowIdx}`,
      operation: values['select_type'] || values['type'] || 'QUERY',
      table: values['table'] || null,
      rowsEstimated: rowsVal,
      rowsActual: null,
      cost: null,
      timeMs: null,
      extra,
      children: [],
    });
  }

  return {
    id: 'mysql-root',
    operation: 'Query Plan',
    table: null,
    rowsEstimated: null,
    rowsActual: null,
    cost: null,
    timeMs: null,
    extra: {},
    children,
  };
}

function computeTotalTime(node: PlanNode): number {
  const childTime = node.children.reduce(
    (sum, c) => sum + computeTotalTime(c),
    0,
  );
  return (node.timeMs ?? 0) + childTime;
}

export function ExplainView({ query }: ExplainViewProps) {
  const { activeConnectionId, activeConfig } = useConnectionStore();
  const [plan, setPlan] = useState<PlanNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);

  const runExplain = useCallback(async () => {
    if (!activeConnectionId || !activeConfig || !query.trim()) return;

    setLoading(true);
    setError(null);
    setPlan(null);

    try {
      const dbType = activeConfig.db_type;
      let explainSql: string;

      if (dbType === 'postgres') {
        explainSql = `EXPLAIN (ANALYZE, FORMAT JSON) ${query}`;
      } else if (dbType === 'mysql') {
        explainSql = `EXPLAIN ${query}`;
      } else {
        setError(`EXPLAIN is not supported for ${dbType}`);
        setLoading(false);
        return;
      }

      const result = await ipc.executeQuery(activeConnectionId, explainSql);
      setExecutionTime(result.execution_time_ms);

      if (dbType === 'postgres') {
        const parsed = parsePostgresExplain(result);
        if (parsed) {
          setPlan(parsed);
        } else {
          setError('Failed to parse EXPLAIN output');
        }
      } else {
        setPlan(parseMySQLExplain(result));
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeConnectionId, activeConfig, query]);

  const totalPlanTime = plan ? computeTotalTime(plan) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b">
        <Button
          size="sm"
          variant="outline"
          onClick={runExplain}
          disabled={loading || !query.trim() || !activeConnectionId}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Play className="size-3.5" />
          )}
          Explain
        </Button>

        {executionTime !== null && (
          <Badge variant="secondary" className="text-xs">
            {executionTime.toFixed(1)}ms total
          </Badge>
        )}

        {totalPlanTime !== null && totalPlanTime > 0 && (
          <Badge
            variant="secondary"
            className={cn(
              'text-xs',
              totalPlanTime < 1
                ? 'text-green-500'
                : totalPlanTime <= 100
                  ? 'text-yellow-500'
                  : 'text-red-500',
            )}
          >
            {totalPlanTime.toFixed(2)}ms plan time
          </Badge>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 overflow-auto">
        <div className="p-3">
          {error && (
            <div className="flex items-center gap-2 text-destructive text-sm mb-3">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="break-all">{error}</span>
            </div>
          )}

          {!plan && !loading && !error && (
            <div className="text-muted-foreground text-sm text-center py-8">
              Click "Explain" to analyze query performance
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              Running EXPLAIN...
            </div>
          )}

          {plan && <PlanNodeCard node={plan} />}
        </div>
      </ScrollArea>
    </div>
  );
}
