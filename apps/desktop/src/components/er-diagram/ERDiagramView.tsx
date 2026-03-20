import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  BackgroundVariant,
} from '@xyflow/react';
import type { ReactFlowInstance, NodeChange, EdgeChange, NodeTypes, EdgeTypes } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

import { useERDiagramStore } from '@/stores/erDiagramStore';
import type { ERNode, EREdge } from '@/stores/erDiagramStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { TableNode } from '@/components/er-diagram/TableNode';
import { RelationEdge } from '@/components/er-diagram/RelationEdge';
import { ERToolbar } from '@/components/er-diagram/ERToolbar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Database, TableProperties } from 'lucide-react';
import { cn } from '@/lib/utils';

// Custom node/edge type registrations
// Cast required: @xyflow/react was compiled against @types/react without bigint in ReactNode.
// React 18.3+ added bigint, causing a structural type mismatch on NodeTypes/EdgeTypes.
const nodeTypes = { table: TableNode } as unknown as NodeTypes;
const edgeTypes = { relation: RelationEdge } as unknown as EdgeTypes;

// === Dagre layout utility ===

const NODE_BASE_HEIGHT = 44; // header height
const NODE_ROW_HEIGHT = 26; // per-column row height
const NODE_WIDTH = 260;

function getLayoutedElements(
  nodes: ERNode[],
  edges: EREdge[],
  direction: 'TB' | 'LR'
): { nodes: ERNode[]; edges: EREdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });

  for (const node of nodes) {
    const columnCount = node.data.collapsed ? 0 : node.data.columns.length;
    const height = NODE_BASE_HEIGHT + columnCount * NODE_ROW_HEIGHT;
    g.setNode(node.id, { width: NODE_WIDTH, height });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    if (!nodeWithPosition) return node;

    const columnCount = node.data.collapsed ? 0 : node.data.columns.length;
    const height = NODE_BASE_HEIGHT + columnCount * NODE_ROW_HEIGHT;

    return {
      ...node,
      position: {
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

// === Inner component (must be within ReactFlowProvider) ===

function ERDiagramInner() {
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance<ERNode, EREdge> | null>(null);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  // Track which database we last applied a dagre layout for, to avoid re-layouting on
  // incremental structure batch updates (which would reset user-dragged positions).
  const lastLayoutDbRef = useRef<string | null>(null);
  const { fitView } = useReactFlow();

  // Store state
  const nodes = useERDiagramStore((s) => s.nodes);
  const edges = useERDiagramStore((s) => s.edges);
  const selectedDatabase = useERDiagramStore((s) => s.selectedDatabase);
  const layoutDirection = useERDiagramStore((s) => s.layoutDirection);
  const generateDiagram = useERDiagramStore((s) => s.generateDiagram);
  const setNodes = useERDiagramStore((s) => s.setNodes);
  const setEdges = useERDiagramStore((s) => s.setEdges);
  const updateNodePosition = useERDiagramStore((s) => s.updateNodePosition);

  const databases = useSchemaStore((s) => s.databases);
  const structures = useSchemaStore((s) => s.structures);
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const loadTables = useSchemaStore((s) => s.loadTables);

  // Auto-select first database when databases load (and no DB is selected yet)
  useEffect(() => {
    if (databases.length > 0 && !selectedDatabase && activeConnectionId) {
      loadTables(activeConnectionId, databases[0].name);
    }
  }, [databases, selectedDatabase, activeConnectionId, loadTables]);

  // Reactively regenerate diagram whenever structures change for the selected database.
  // This fixes the race with schemaStore._loadGeneration: even if the ER diagram's
  // loadTables() call exits early, the diagram rebuilds once structures actually arrive.
  useEffect(() => {
    if (!selectedDatabase) return;
    generateDiagram(selectedDatabase);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structures]);

  // Apply dagre layout when the database changes (not on every structure batch update,
  // since generateDiagram now preserves existing node positions).
  useEffect(() => {
    if (nodes.length === 0 || !selectedDatabase) return;
    if (lastLayoutDbRef.current === selectedDatabase) return;

    lastLayoutDbRef.current = selectedDatabase;
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      layoutDirection
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDatabase, nodes.length]);

  // Re-layout when direction changes
  useEffect(() => {
    if (nodes.length === 0) return;
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges,
      layoutDirection
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
    requestAnimationFrame(() => fitView({ padding: 0.15, duration: 300 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutDirection]);

  // Handle database selection change
  const handleDatabaseChange = useCallback(
    (database: string) => {
      if (!activeConnectionId) return;
      // Reset layout tracker so dagre re-runs for the new database
      lastLayoutDbRef.current = null;
      // Start loading tables/structures; the [structures] effect will trigger generateDiagram
      loadTables(activeConnectionId, database);
      // Also generate immediately with whatever is cached (empty columns if not yet loaded)
      generateDiagram(database);
    },
    [activeConnectionId, loadTables, generateDiagram]
  );

  // Handle node position changes (drag)
  const onNodesChange = useCallback(
    (changes: NodeChange<ERNode>[]) => {
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          updateNodePosition(change.id, change.position);
        }
      }
    },
    [updateNodePosition]
  );

  // Handle edge changes (e.g., selections)
  const onEdgesChange = useCallback(
    (_changes: EdgeChange<EREdge>[]) => {
      // Edges are read-only in this diagram; no-op
    },
    []
  );

  const onInit = useCallback((instance: ReactFlowInstance<ERNode, EREdge>) => {
    setRfInstance(instance);
  }, []);

  // Memoize the default edge options
  const defaultEdgeOptions = useMemo(
    () => ({
      animated: true,
    }),
    []
  );

  const isEmpty = nodes.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      {/* Top bar: database selector + toolbar */}
      <div className="flex items-center gap-3 border-b border-border bg-muted/50 px-3 py-2">
        <div className="flex items-center gap-2">
          <Database className="size-4 text-muted-foreground" />
          <Select
            value={selectedDatabase ?? undefined}
            onValueChange={handleDatabaseChange}
          >
            <SelectTrigger size="sm" className="w-[200px]">
              <SelectValue placeholder="Select database" />
            </SelectTrigger>
            <SelectContent>
              {databases.map((db) => (
                <SelectItem key={db.name} value={db.name}>
                  {db.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {nodes.length > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TableProperties className="size-3.5" />
            <span>
              {nodes.length} table{nodes.length !== 1 ? 's' : ''}
              {edges.length > 0 && (
                <>, {edges.length} relation{edges.length !== 1 ? 's' : ''}</>
              )}
            </span>
          </div>
        )}

        <div className="flex-1" />

        <ERToolbar rfInstance={rfInstance} />
      </div>

      {/* Diagram area */}
      <div ref={reactFlowWrapper} className="relative flex-1">
        {isEmpty ? (
          <div className="flex h-full w-full items-center justify-center">
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <TableProperties className="size-12 opacity-30" />
              <p className="text-sm">
                {databases.length === 0
                  ? 'No databases available. Connect to a database first.'
                  : 'Select a database to generate the ER diagram.'}
              </p>
              <p className="text-xs opacity-60">
                Tables and their relationships will be visualized automatically.
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
            onInit={onInit}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            fitViewOptions={{ padding: 0.15 }}
            minZoom={0.1}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
            className={cn('bg-background')}
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
            <MiniMap
              nodeStrokeWidth={3}
              className="!bg-muted !border-border !shadow-sm"
              maskColor="hsl(var(--muted) / 0.7)"
            />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

// === Exported wrapper with ReactFlowProvider ===

export function ERDiagramView() {
  return (
    <ReactFlowProvider>
      <ERDiagramInner />
    </ReactFlowProvider>
  );
}
