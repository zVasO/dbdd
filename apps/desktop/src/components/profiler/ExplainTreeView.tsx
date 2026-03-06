import { useState, useMemo, useRef, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Clock, Rows3, DollarSign, Flame } from 'lucide-react';
import type { PlanNode } from '@/components/profiler/PlanNodeCard';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ExplainTreeViewProps {
  plan: PlanNode;
  totalTime?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number | null): string {
  if (n === null) return '-';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function formatMs(ms: number | null): string {
  if (ms === null) return '-';
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(2)}ms`;
}

/** Recursively compute the total cost of the entire plan tree. */
function computeTotalCost(node: PlanNode): number {
  return (
    (node.cost ?? 0) +
    node.children.reduce((sum, c) => sum + computeTotalCost(c), 0)
  );
}

/** Recursively compute the total time of the entire plan tree. */
function computeTotalTime(node: PlanNode): number {
  return (
    (node.timeMs ?? 0) +
    node.children.reduce((sum, c) => sum + computeTotalTime(c), 0)
  );
}

/** Find the deepest nesting level (root = 0). */
function computeMaxDepth(node: PlanNode, depth: number = 0): number {
  if (node.children.length === 0) return depth;
  return Math.max(...node.children.map((c) => computeMaxDepth(c, depth + 1)));
}

/** Find the single most expensive node by cost. */
function findMostExpensive(node: PlanNode): PlanNode {
  let best = node;
  for (const child of node.children) {
    const childBest = findMostExpensive(child);
    if ((childBest.cost ?? 0) > (best.cost ?? 0)) best = childBest;
  }
  return best;
}

/** Find the single slowest node by time. */
function findSlowest(node: PlanNode): PlanNode {
  let best = node;
  for (const child of node.children) {
    const childBest = findSlowest(child);
    if ((childBest.timeMs ?? 0) > (best.timeMs ?? 0)) best = childBest;
  }
  return best;
}

/**
 * Returns a heatmap colour (HSL string) based on a 0-1 ratio.
 * 0 = cool (green-ish, hue 120) ... 1 = hot (red, hue 0).
 */
function heatColor(ratio: number, alpha: number = 1): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  // Hue: 120 (green) -> 30 (orange) -> 0 (red)
  const hue = 120 - clamped * 120;
  const saturation = 70 + clamped * 20;
  const lightness = 45 + (1 - clamped) * 10;
  return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

/**
 * Returns the CSS border-colour for the "hotness" glow.
 * Only nodes above 50% of max time get a visible glow.
 */
function glowStyle(
  nodeTimeMs: number | null,
  maxTimeMs: number,
): React.CSSProperties {
  if (nodeTimeMs === null || maxTimeMs <= 0) return {};
  const ratio = nodeTimeMs / maxTimeMs;
  if (ratio < 0.3) return {};
  const color = heatColor(ratio, 0.7);
  return {
    boxShadow: `0 0 ${Math.round(ratio * 12)}px ${Math.round(ratio * 4)}px ${color}`,
    borderColor: heatColor(ratio, 0.9),
  };
}

/** Cost bar colour class. */
function costBarColor(cost: number | null): string {
  if (cost === null) return 'bg-muted-foreground/30';
  if (cost < 10) return 'bg-green-500';
  if (cost < 100) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ---------------------------------------------------------------------------
// Layout engine — assigns x,y coords to each node so we can draw SVG lines
// ---------------------------------------------------------------------------

interface LayoutNode {
  node: PlanNode;
  x: number; // centre x
  y: number; // top y
  width: number;
  height: number;
  children: LayoutNode[];
}

const NODE_WIDTH = 260;
const NODE_HEIGHT = 160;
const H_GAP = 32;
const V_GAP = 56;

/**
 * Recursively lay out the tree.  Returns a LayoutNode and the total subtree width.
 */
function layoutTree(
  node: PlanNode,
  collapsedSet: Set<string>,
  depth: number = 0,
): { layout: LayoutNode; width: number } {
  const isCollapsed = collapsedSet.has(node.id);
  const visibleChildren =
    isCollapsed || node.children.length === 0 ? [] : node.children;

  const childLayouts: { layout: LayoutNode; width: number }[] = visibleChildren.map(
    (child) => layoutTree(child, collapsedSet, depth + 1),
  );

  const totalChildWidth =
    childLayouts.length > 0
      ? childLayouts.reduce((sum, c) => sum + c.width, 0) +
        (childLayouts.length - 1) * H_GAP
      : 0;

  const subtreeWidth = Math.max(NODE_WIDTH, totalChildWidth);

  // Position children within the subtree band
  let cursor = 0;
  const positionedChildren: LayoutNode[] = [];
  for (const { layout, width } of childLayouts) {
    const childCenterX = cursor + width / 2;
    const offsetLayout = offsetNode(layout, childCenterX - layout.x, 0);
    positionedChildren.push(offsetLayout);
    cursor += width + H_GAP;
  }

  // Centre the children block within subtreeWidth
  const shiftChildren = (subtreeWidth - totalChildWidth) / 2;
  const finalChildren = positionedChildren.map((c) =>
    offsetNode(c, shiftChildren, 0),
  );

  const layout: LayoutNode = {
    node,
    x: subtreeWidth / 2,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    children: finalChildren.map((c) =>
      offsetNode(c, 0, NODE_HEIGHT + V_GAP),
    ),
  };

  return { layout, width: subtreeWidth };
}

function offsetNode(ln: LayoutNode, dx: number, dy: number): LayoutNode {
  return {
    ...ln,
    x: ln.x + dx,
    y: ln.y + dy,
    children: ln.children.map((c) => offsetNode(c, dx, dy)),
  };
}

/** Compute the bounding box of the full tree. */
function treeBounds(ln: LayoutNode): { maxX: number; maxY: number } {
  let maxX = ln.x + ln.width / 2;
  let maxY = ln.y + ln.height;
  for (const child of ln.children) {
    const cb = treeBounds(child);
    if (cb.maxX > maxX) maxX = cb.maxX;
    if (cb.maxY > maxY) maxY = cb.maxY;
  }
  return { maxX, maxY };
}

// ---------------------------------------------------------------------------
// SVG connector lines
// ---------------------------------------------------------------------------

function ConnectorLines({ layout }: { layout: LayoutNode }) {
  const lines: React.ReactNode[] = [];

  function walk(parent: LayoutNode) {
    for (const child of parent.children) {
      const x1 = parent.x;
      const y1 = parent.y + parent.height;
      const x2 = child.x;
      const y2 = child.y;
      const midY = (y1 + y2) / 2;

      lines.push(
        <path
          key={`${parent.node.id}-${child.node.id}`}
          d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-border"
          strokeDasharray="none"
          opacity={0.6}
        />,
      );
      walk(child);
    }
  }
  walk(layout);

  return <>{lines}</>;
}

// ---------------------------------------------------------------------------
// Rows accuracy bar
// ---------------------------------------------------------------------------

function RowsBar({
  estimated,
  actual,
}: {
  estimated: number | null;
  actual: number | null;
}) {
  if (estimated === null && actual === null) return null;

  const est = estimated ?? 0;
  const act = actual ?? 0;
  const max = Math.max(est, act, 1);
  const estPct = (est / max) * 100;
  const actPct = (act / max) * 100;

  const accuracy =
    estimated !== null && actual !== null && estimated > 0
      ? Math.round((actual / estimated) * 100)
      : null;

  return (
    <div className="flex flex-col gap-0.5 w-full">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>est: {formatNumber(estimated)}</span>
        <span>act: {formatNumber(actual)}</span>
        {accuracy !== null && (
          <span
            className={cn(
              'font-medium',
              accuracy > 150 || accuracy < 50
                ? 'text-red-400'
                : accuracy > 120 || accuracy < 80
                  ? 'text-yellow-400'
                  : 'text-green-400',
            )}
          >
            {accuracy}%
          </span>
        )}
      </div>
      <div className="relative h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-blue-500/40"
          style={{ width: `${estPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-blue-400"
          style={{ width: `${actPct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Node card
// ---------------------------------------------------------------------------

interface TreeNodeCardProps {
  layout: LayoutNode;
  totalCost: number;
  maxTimeMs: number;
  collapsedSet: Set<string>;
  onToggle: (id: string) => void;
}

function TreeNodeCard({
  layout,
  totalCost,
  maxTimeMs,
  collapsedSet,
  onToggle,
}: TreeNodeCardProps) {
  const { node } = layout;
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedSet.has(node.id);
  const costRatio = totalCost > 0 ? (node.cost ?? 0) / totalCost : 0;

  const bgAlpha = 0.08 + costRatio * 0.18;
  const heatBg = heatColor(costRatio, bgAlpha);

  return (
    <>
      {/* The card itself */}
      <foreignObject
        x={layout.x - layout.width / 2}
        y={layout.y}
        width={layout.width}
        height={layout.height}
      >
        <div
          className={cn(
            'h-full rounded-lg border border-border px-3 py-2 flex flex-col gap-1 cursor-pointer select-none',
            'transition-shadow duration-200',
          )}
          style={{
            backgroundColor: heatBg,
            ...glowStyle(node.timeMs, maxTimeMs),
          }}
          onClick={() => hasChildren && onToggle(node.id)}
        >
          {/* Header row */}
          <div className="flex items-center gap-1.5">
            {hasChildren && (
              <span className="shrink-0 text-muted-foreground">
                {isCollapsed ? (
                  <ChevronRight className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </span>
            )}
            <span className="font-semibold text-sm text-foreground truncate">
              {node.operation}
            </span>
          </div>

          {/* Table name */}
          {node.table && (
            <span className="text-xs font-mono text-muted-foreground truncate">
              {node.table}
            </span>
          )}

          {/* Cost bar */}
          <div className="flex items-center gap-1.5">
            <DollarSign className="size-3 text-muted-foreground shrink-0" />
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn('h-full rounded-full', costBarColor(node.cost))}
                style={{ width: `${Math.min(costRatio * 100, 100) * 3 + 5}%` }}
              />
            </div>
            <span className="text-[10px] text-muted-foreground w-12 text-right tabular-nums">
              {node.cost !== null ? node.cost.toFixed(1) : '-'}
            </span>
          </div>

          {/* Rows: estimated vs actual */}
          <div className="flex items-center gap-1.5">
            <Rows3 className="size-3 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <RowsBar estimated={node.rowsEstimated} actual={node.rowsActual} />
            </div>
          </div>

          {/* Time */}
          <div className="flex items-center gap-1.5">
            <Clock className="size-3 text-muted-foreground shrink-0" />
            <span
              className={cn(
                'text-xs tabular-nums',
                node.timeMs === null
                  ? 'text-muted-foreground'
                  : node.timeMs < 1
                    ? 'text-green-400'
                    : node.timeMs <= 100
                      ? 'text-yellow-400'
                      : 'text-red-400',
              )}
            >
              {formatMs(node.timeMs)}
            </span>
            {node.timeMs !== null && maxTimeMs > 0 && (
              <Flame
                className={cn(
                  'size-3 shrink-0',
                  node.timeMs / maxTimeMs > 0.7
                    ? 'text-red-400'
                    : node.timeMs / maxTimeMs > 0.4
                      ? 'text-orange-400'
                      : 'text-muted-foreground/40',
                )}
              />
            )}
          </div>
        </div>
      </foreignObject>

      {/* Recursively render children */}
      {layout.children.map((childLayout) => (
        <TreeNodeCard
          key={childLayout.node.id}
          layout={childLayout}
          totalCost={totalCost}
          maxTimeMs={maxTimeMs}
          collapsedSet={collapsedSet}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Summary stats bar
// ---------------------------------------------------------------------------

function SummaryStats({
  plan,
  totalCost,
  totalTimeMs,
  maxDepth,
  mostExpensive,
  slowest,
}: {
  plan: PlanNode;
  totalCost: number;
  totalTimeMs: number;
  maxDepth: number;
  mostExpensive: PlanNode;
  slowest: PlanNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-2 border-b border-border bg-muted/40 text-xs">
      <div className="flex items-center gap-1.5">
        <DollarSign className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Total cost:</span>
        <span className="font-medium text-foreground tabular-nums">
          {totalCost.toFixed(2)}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Clock className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground">Total time:</span>
        <span className="font-medium text-foreground tabular-nums">
          {formatMs(totalTimeMs)}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Depth:</span>
        <span className="font-medium text-foreground">{maxDepth}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <Flame className="size-3.5 text-orange-400" />
        <span className="text-muted-foreground">Most expensive:</span>
        <span className="font-medium text-foreground truncate max-w-[160px]">
          {mostExpensive.operation}
          {mostExpensive.table ? ` (${mostExpensive.table})` : ''}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {mostExpensive.cost !== null ? mostExpensive.cost.toFixed(1) : '-'}
        </span>
      </div>

      {slowest.timeMs !== null && slowest.timeMs > 0 && (
        <div className="flex items-center gap-1.5">
          <Flame className="size-3.5 text-red-400" />
          <span className="text-muted-foreground">Slowest:</span>
          <span className="font-medium text-foreground truncate max-w-[160px]">
            {slowest.operation}
            {slowest.table ? ` (${slowest.table})` : ''}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {formatMs(slowest.timeMs)}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ExplainTreeView({ plan, totalTime }: ExplainTreeViewProps) {
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  const onToggle = useCallback((id: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Derived statistics
  const stats = useMemo(() => {
    const totalCost = computeTotalCost(plan);
    const totalTimeMs = totalTime ?? computeTotalTime(plan);
    const maxDepth = computeMaxDepth(plan);
    const mostExpensive = findMostExpensive(plan);
    const slowest = findSlowest(plan);
    return { totalCost, totalTimeMs, maxDepth, mostExpensive, slowest };
  }, [plan, totalTime]);

  // Layout
  const { rootLayout, svgWidth, svgHeight } = useMemo(() => {
    const { layout, width } = layoutTree(plan, collapsedSet);
    const bounds = treeBounds(layout);
    const padding = 40;
    return {
      rootLayout: offsetNode(layout, padding, padding),
      svgWidth: Math.max(bounds.maxX + padding * 2, 400),
      svgHeight: bounds.maxY + padding * 2,
    };
  }, [plan, collapsedSet]);

  // The max time across all nodes, used for hotness glow
  const maxNodeTime = useMemo(() => {
    const s = findSlowest(plan);
    return s.timeMs ?? 0;
  }, [plan]);

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <SummaryStats
        plan={plan}
        totalCost={stats.totalCost}
        totalTimeMs={stats.totalTimeMs}
        maxDepth={stats.maxDepth}
        mostExpensive={stats.mostExpensive}
        slowest={stats.slowest}
      />

      {/* Scrollable tree area */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto"
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          className="min-w-full"
          style={{ minWidth: svgWidth, minHeight: svgHeight }}
        >
          {/* Connector lines (rendered first, behind cards) */}
          <ConnectorLines layout={rootLayout} />

          {/* Node cards */}
          <TreeNodeCard
            layout={rootLayout}
            totalCost={stats.totalCost}
            maxTimeMs={maxNodeTime}
            collapsedSet={collapsedSet}
            onToggle={onToggle}
          />
        </svg>
      </div>
    </div>
  );
}
