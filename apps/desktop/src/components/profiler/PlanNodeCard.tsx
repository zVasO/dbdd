import { useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

export interface PlanNode {
  id: string;
  operation: string;
  table: string | null;
  rowsEstimated: number | null;
  rowsActual: number | null;
  cost: number | null;
  timeMs: number | null;
  children: PlanNode[];
  extra: Record<string, string>;
}

interface PlanNodeCardProps {
  node: PlanNode;
  depth?: number;
}

function getTimeBadgeVariant(
  timeMs: number | null,
): 'default' | 'secondary' | 'destructive' {
  if (timeMs === null) return 'secondary';
  if (timeMs < 1) return 'default';
  if (timeMs <= 100) return 'secondary';
  return 'destructive';
}

function getTimeColorClass(timeMs: number | null): string {
  if (timeMs === null) return 'text-muted-foreground';
  if (timeMs < 1) return 'text-green-500';
  if (timeMs <= 100) return 'text-yellow-500';
  return 'text-red-500';
}

function formatNumber(n: number | null): string {
  if (n === null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function PlanNodeCard({ node, depth = 0 }: PlanNodeCardProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col">
      <div
        className="flex items-start gap-1"
        style={{ paddingLeft: `${depth * 24}px` }}
      >
        {/* Connector line */}
        {depth > 0 && (
          <div className="flex items-center h-8 mr-1">
            <div className="w-3 h-px bg-border" />
          </div>
        )}

        {/* Expand/collapse toggle */}
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex items-center justify-center size-5 mt-1.5 rounded-sm shrink-0',
            hasChildren
              ? 'hover:bg-accent cursor-pointer'
              : 'opacity-0 pointer-events-none',
          )}
        >
          {hasChildren &&
            (expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            ))}
        </button>

        {/* Node card */}
        <div
          className={cn(
            'flex-1 rounded-md border px-3 py-2 my-0.5',
            'bg-card text-card-foreground',
          )}
        >
          <div className="flex items-center gap-2 flex-wrap">
            {/* Operation name */}
            <span className="font-semibold text-sm">{node.operation}</span>

            {/* Table name */}
            {node.table && (
              <Badge variant="outline" className="text-xs font-mono">
                {node.table}
              </Badge>
            )}

            {/* Time badge */}
            {node.timeMs !== null && (
              <Badge
                variant={getTimeBadgeVariant(node.timeMs)}
                className={cn('text-xs', getTimeColorClass(node.timeMs))}
              >
                {node.timeMs.toFixed(2)}ms
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
            {/* Rows */}
            {(node.rowsEstimated !== null || node.rowsActual !== null) && (
              <span>
                Rows:{' '}
                {node.rowsEstimated !== null && node.rowsActual !== null ? (
                  <>
                    <span className="text-foreground">
                      {formatNumber(node.rowsActual)}
                    </span>
                    {' / '}
                    <span>{formatNumber(node.rowsEstimated)} est</span>
                  </>
                ) : (
                  <span className="text-foreground">
                    {formatNumber(node.rowsActual ?? node.rowsEstimated)}
                  </span>
                )}
              </span>
            )}

            {/* Cost */}
            {node.cost !== null && (
              <span>
                Cost:{' '}
                <span className="text-foreground">{node.cost.toFixed(2)}</span>
              </span>
            )}

            {/* Extra info */}
            {Object.entries(node.extra).map(([key, value]) => (
              <span key={key}>
                {key}:{' '}
                <span className="text-foreground">{value}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Children */}
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <PlanNodeCard key={child.id} node={child} depth={depth + 1} />
        ))}
    </div>
  );
}
