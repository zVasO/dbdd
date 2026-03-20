import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
} from '@xyflow/react';
import type { Connection, NodeTypes, EdgeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Code2, Filter, ArrowUpDown, Blocks } from 'lucide-react';

import { useQueryBuilderStore } from '@/stores/queryBuilderStore';
import { TableBlock } from '@/components/query-builder/TableBlock';
import { JoinEdge } from '@/components/query-builder/JoinEdge';
import { BuilderToolbar } from '@/components/query-builder/BuilderToolbar';
import { SQLPreview } from '@/components/query-builder/SQLPreview';
import { FilterPanel } from '@/components/query-builder/FilterPanel';

// Register custom node and edge types (must be outside component to avoid re-renders)
// Cast required: @xyflow/react was compiled against @types/react without bigint in ReactNode.
// React 18.3+ added bigint, causing a structural type mismatch on NodeTypes/EdgeTypes.
const nodeTypes = { tableBlock: TableBlock } as unknown as NodeTypes;
const edgeTypes = { joinEdge: JoinEdge } as unknown as EdgeTypes;

function QueryBuilderInner() {
  const nodes = useQueryBuilderStore((s) => s.nodes);
  const edges = useQueryBuilderStore((s) => s.edges);
  const onNodesChange = useQueryBuilderStore((s) => s.onNodesChange);
  const onEdgesChange = useQueryBuilderStore((s) => s.onEdgesChange);
  const onConnect = useQueryBuilderStore((s) => s.onConnect);

  const handleConnect = useCallback(
    (connection: Connection) => {
      onConnect(connection);
    },
    [onConnect]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'joinEdge' as const,
    }),
    []
  );

  const isEmpty = nodes.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Toolbar */}
      <BuilderToolbar />

      {/* Main canvas area (70%) */}
      <div className="relative flex-[7] min-h-0">
        {isEmpty ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Blocks className="size-12 opacity-30" />
              <p className="text-sm">
                Add tables using the toolbar to start building your query.
              </p>
              <p className="text-xs opacity-60">
                Drag between column handles to create JOINs.
              </p>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={handleConnect}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.2}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            className={cn('bg-background')}
            connectionLineStyle={{ stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              className="!bg-background"
            />
            <Controls
              showInteractive={false}
              className="!bg-background !border-border !shadow-sm [&>button]:!bg-background [&>button]:!border-border [&>button]:hover:!bg-muted [&>button>svg]:!fill-foreground"
            />
          </ReactFlow>
        )}
      </div>

      {/* Bottom panel (30%) with tabs */}
      <div className="flex-[3] min-h-0 border-t border-border bg-card">
        <Tabs defaultValue="sql" className="h-full flex flex-col">
          <TabsList variant="line" className="shrink-0 px-2 border-b border-border">
            <TabsTrigger value="sql" className="text-xs gap-1.5">
              <Code2 className="size-3" />
              SQL Preview
            </TabsTrigger>
            <TabsTrigger value="filters" className="text-xs gap-1.5">
              <Filter className="size-3" />
              Filters & Grouping
            </TabsTrigger>
          </TabsList>

          <TabsContent value="sql" className="flex-1 min-h-0 overflow-hidden">
            <SQLPreview />
          </TabsContent>

          <TabsContent value="filters" className="flex-1 min-h-0 overflow-hidden">
            <FilterPanel />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export function QueryBuilderView() {
  return (
    <ReactFlowProvider>
      <QueryBuilderInner />
    </ReactFlowProvider>
  );
}
