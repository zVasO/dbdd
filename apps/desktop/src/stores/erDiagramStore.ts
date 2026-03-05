import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { useSchemaStore } from '@/stores/schemaStore';
import type { ForeignKeyInfo } from '@/lib/types';

// === Types ===

export interface ERColumnInfo {
  name: string;
  type: string;
  isPK: boolean;
  isFK: boolean;
  nullable: boolean;
}

export interface ERNodeData extends Record<string, unknown> {
  tableName: string;
  database: string;
  columns: ERColumnInfo[];
  collapsed: boolean;
}

export type ERNode = Node<ERNodeData, 'table'>;

export interface EREdgeData extends Record<string, unknown> {
  sourceTable: string;
  targetTable: string;
  sourceColumns: string[];
  targetColumns: string[];
  fkName: string;
  onUpdate: string;
  onDelete: string;
}

export type EREdge = Edge<EREdgeData, 'relation'>;

// === Store ===

interface ERDiagramState {
  nodes: ERNode[];
  edges: EREdge[];
  selectedDatabase: string | null;
  layoutDirection: 'TB' | 'LR';

  generateDiagram: (database: string) => void;
  setLayoutDirection: (dir: 'TB' | 'LR') => void;
  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
  toggleNodeCollapsed: (nodeId: string) => void;
  setNodes: (nodes: ERNode[]) => void;
  setEdges: (edges: EREdge[]) => void;
}

export const useERDiagramStore = create<ERDiagramState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedDatabase: null,
  layoutDirection: 'TB',

  generateDiagram: (database: string) => {
    const { tables, structures } = useSchemaStore.getState();
    const dbTables = tables[database] ?? [];

    if (dbTables.length === 0) {
      set({ nodes: [], edges: [], selectedDatabase: database });
      return;
    }

    // Collect all FK column names per table for isFK tagging
    const fkColumnsByTable = new Map<string, Set<string>>();
    for (const tableInfo of dbTables) {
      const key = `${database}.${tableInfo.name}`;
      const structure = structures[key];
      if (!structure) continue;
      const fkCols = new Set<string>();
      for (const fk of structure.foreign_keys) {
        for (const col of fk.columns) {
          fkCols.add(col);
        }
      }
      fkColumnsByTable.set(tableInfo.name, fkCols);
    }

    // Build nodes
    const nodes: ERNode[] = dbTables
      .filter((t) => t.table_type === 'Table')
      .map((tableInfo, index) => {
        const key = `${database}.${tableInfo.name}`;
        const structure = structures[key];
        const fkCols = fkColumnsByTable.get(tableInfo.name) ?? new Set<string>();

        const columns: ERColumnInfo[] = (structure?.columns ?? []).map((col) => ({
          name: col.name,
          type: col.data_type,
          isPK: col.is_primary_key,
          isFK: fkCols.has(col.name),
          nullable: col.nullable,
        }));

        return {
          id: tableInfo.name,
          type: 'table' as const,
          position: { x: (index % 4) * 300, y: Math.floor(index / 4) * 400 },
          data: {
            tableName: tableInfo.name,
            database,
            columns,
            collapsed: false,
          },
        };
      });

    // Build edges from foreign keys
    const edges: EREdge[] = [];
    const tableNameSet = new Set(nodes.map((n) => n.id));

    for (const tableInfo of dbTables) {
      const key = `${database}.${tableInfo.name}`;
      const structure = structures[key];
      if (!structure) continue;

      for (const fk of structure.foreign_keys) {
        const targetTable = fk.referenced_table.table;

        // Only create edge if both tables are present
        if (!tableNameSet.has(tableInfo.name) || !tableNameSet.has(targetTable)) {
          continue;
        }

        const edgeId = `${tableInfo.name}-${targetTable}-${fk.name}`;
        const label = buildEdgeLabel(fk);

        edges.push({
          id: edgeId,
          type: 'relation',
          source: tableInfo.name,
          target: targetTable,
          sourceHandle: `${tableInfo.name}-source`,
          targetHandle: `${targetTable}-target`,
          data: {
            sourceTable: tableInfo.name,
            targetTable,
            sourceColumns: fk.columns,
            targetColumns: fk.referenced_columns,
            fkName: fk.name,
            onUpdate: fk.on_update,
            onDelete: fk.on_delete,
          },
          label,
        });
      }
    }

    set({ nodes, edges, selectedDatabase: database });
  },

  setLayoutDirection: (dir: 'TB' | 'LR') => {
    set({ layoutDirection: dir });
  },

  updateNodePosition: (nodeId: string, position: { x: number; y: number }) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId ? { ...node, position } : node
      ),
    }));
  },

  toggleNodeCollapsed: (nodeId: string) => {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === nodeId
          ? { ...node, data: { ...node.data, collapsed: !node.data.collapsed } }
          : node
      ),
    }));
  },

  setNodes: (nodes: ERNode[]) => {
    set({ nodes });
  },

  setEdges: (edges: EREdge[]) => {
    set({ edges });
  },
}));

function buildEdgeLabel(fk: ForeignKeyInfo): string {
  const cols = fk.columns.join(', ');
  const refCols = fk.referenced_columns.join(', ');
  return `${cols} -> ${refCols}`;
}
