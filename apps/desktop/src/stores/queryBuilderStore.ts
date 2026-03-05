import { create } from 'zustand';
import type { Node, Edge, Connection } from '@xyflow/react';
import { applyNodeChanges, applyEdgeChanges } from '@xyflow/react';
import type { NodeChange, EdgeChange } from '@xyflow/react';

// === Types ===

export interface TableNodeData extends Record<string, unknown> {
  database: string;
  tableName: string;
  columns: { name: string; type: string; isPK: boolean; nullable: boolean }[];
  selectedColumns: string[];
}

export interface JoinConfig {
  id: string;
  sourceNodeId: string;
  sourceColumn: string;
  targetNodeId: string;
  targetColumn: string;
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
}

export interface WhereFilter {
  id: string;
  nodeId: string;
  tableName: string;
  column: string;
  operator: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'LIKE' | 'NOT LIKE' | 'IN' | 'IS NULL' | 'IS NOT NULL';
  value: string;
  enabled: boolean;
}

export interface OrderByEntry {
  table: string;
  column: string;
  direction: 'ASC' | 'DESC';
}

interface QueryBuilderState {
  nodes: Node<TableNodeData>[];
  edges: Edge[];
  joins: JoinConfig[];
  whereFilters: WhereFilter[];
  groupByColumns: string[];
  orderByColumns: OrderByEntry[];
  limit: number | null;
  distinct: boolean;

  addTable: (database: string, tableName: string, columns: TableNodeData['columns']) => void;
  removeTable: (nodeId: string) => void;
  toggleColumn: (nodeId: string, columnName: string) => void;
  selectAllColumns: (nodeId: string) => void;
  deselectAllColumns: (nodeId: string) => void;

  onNodesChange: (changes: NodeChange<Node<TableNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  onConnect: (connection: Connection) => void;

  updateJoinType: (joinId: string, type: JoinConfig['joinType']) => void;
  removeJoin: (joinId: string) => void;

  addWhereFilter: () => void;
  updateWhereFilter: (id: string, updates: Partial<WhereFilter>) => void;
  removeWhereFilter: (id: string) => void;

  setGroupBy: (columns: string[]) => void;
  addOrderBy: (table: string, column: string, direction: 'ASC' | 'DESC') => void;
  removeOrderBy: (index: number) => void;
  setLimit: (limit: number | null) => void;
  setDistinct: (distinct: boolean) => void;

  generateSQL: () => string;
  reset: () => void;
}

// === Helpers ===

function makeNodeId(): string {
  return `table_${crypto.randomUUID().slice(0, 8)}`;
}

function makeFilterId(): string {
  return `filter_${crypto.randomUUID().slice(0, 8)}`;
}

/**
 * Parse a handle ID to extract nodeId and columnName.
 * Handle IDs follow the pattern: `${nodeId}__${columnName}__left` or `${nodeId}__${columnName}__right`
 */
function parseHandleId(handleId: string): { nodeId: string; column: string } | null {
  const parts = handleId.split('__');
  if (parts.length < 3) return null;
  return {
    nodeId: parts[0],
    column: parts[1],
  };
}

// === Store ===

export const useQueryBuilderStore = create<QueryBuilderState>((set, get) => ({
  nodes: [],
  edges: [],
  joins: [],
  whereFilters: [],
  groupByColumns: [],
  orderByColumns: [],
  limit: 500,
  distinct: false,

  addTable: (database, tableName, columns) => {
    const nodeId = makeNodeId();
    const existingCount = get().nodes.length;

    const newNode: Node<TableNodeData> = {
      id: nodeId,
      type: 'tableBlock',
      position: { x: existingCount * 300, y: 100 },
      data: {
        database,
        tableName,
        columns,
        selectedColumns: columns.map((c) => c.name),
      },
    };

    set((s) => ({ nodes: [...s.nodes, newNode] }));
  },

  removeTable: (nodeId) => {
    set((s) => {
      // Remove the node
      const nodes = s.nodes.filter((n) => n.id !== nodeId);
      // Remove edges connected to this node
      const edges = s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      // Remove joins for this node
      const joins = s.joins.filter(
        (j) => j.sourceNodeId !== nodeId && j.targetNodeId !== nodeId
      );
      // Remove filters for this node
      const whereFilters = s.whereFilters.filter((f) => f.nodeId !== nodeId);
      // Remove group by columns for this node
      const removedTableName = s.nodes.find((n) => n.id === nodeId)?.data.tableName;
      const groupByColumns = s.groupByColumns.filter(
        (col) => !col.startsWith(`${removedTableName}.`)
      );
      // Remove order by columns for this node
      const orderByColumns = s.orderByColumns.filter(
        (o) => o.table !== removedTableName
      );

      return { nodes, edges, joins, whereFilters, groupByColumns, orderByColumns };
    });
  },

  toggleColumn: (nodeId, columnName) => {
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const selected = n.data.selectedColumns;
        const isSelected = selected.includes(columnName);
        return {
          ...n,
          data: {
            ...n.data,
            selectedColumns: isSelected
              ? selected.filter((c) => c !== columnName)
              : [...selected, columnName],
          },
        };
      }),
    }));
  },

  selectAllColumns: (nodeId) => {
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            selectedColumns: n.data.columns.map((c) => c.name),
          },
        };
      }),
    }));
  },

  deselectAllColumns: (nodeId) => {
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          data: {
            ...n.data,
            selectedColumns: [],
          },
        };
      }),
    }));
  },

  onNodesChange: (changes) => {
    set((s) => ({
      nodes: applyNodeChanges(changes, s.nodes),
    }));
  },

  onEdgesChange: (changes) => {
    set((s) => ({
      edges: applyEdgeChanges(changes, s.edges),
    }));
  },

  onConnect: (connection) => {
    const { source, target, sourceHandle, targetHandle } = connection;
    if (!source || !target || !sourceHandle || !targetHandle) return;

    const sourceParsed = parseHandleId(sourceHandle);
    const targetParsed = parseHandleId(targetHandle);
    if (!sourceParsed || !targetParsed) return;

    const state = get();
    const sourceNode = state.nodes.find((n) => n.id === sourceParsed.nodeId);
    const targetNode = state.nodes.find((n) => n.id === targetParsed.nodeId);
    if (!sourceNode || !targetNode) return;

    const joinId = `join_${crypto.randomUUID().slice(0, 8)}`;

    const newJoin: JoinConfig = {
      id: joinId,
      sourceNodeId: sourceParsed.nodeId,
      sourceColumn: sourceParsed.column,
      targetNodeId: targetParsed.nodeId,
      targetColumn: targetParsed.column,
      joinType: 'INNER',
    };

    const newEdge: Edge = {
      id: joinId,
      source: sourceParsed.nodeId,
      target: targetParsed.nodeId,
      sourceHandle,
      targetHandle,
      type: 'joinEdge',
      data: {
        joinType: 'INNER',
        sourceColumn: sourceParsed.column,
        targetColumn: targetParsed.column,
      },
    };

    set((s) => ({
      joins: [...s.joins, newJoin],
      edges: [...s.edges, newEdge],
    }));
  },

  updateJoinType: (joinId, type) => {
    set((s) => ({
      joins: s.joins.map((j) => (j.id === joinId ? { ...j, joinType: type } : j)),
      edges: s.edges.map((e) =>
        e.id === joinId
          ? { ...e, data: { ...e.data, joinType: type } }
          : e
      ),
    }));
  },

  removeJoin: (joinId) => {
    set((s) => ({
      joins: s.joins.filter((j) => j.id !== joinId),
      edges: s.edges.filter((e) => e.id !== joinId),
    }));
  },

  addWhereFilter: () => {
    const state = get();
    const firstNode = state.nodes[0];
    const firstColumn = firstNode?.data.columns[0];

    const newFilter: WhereFilter = {
      id: makeFilterId(),
      nodeId: firstNode?.id ?? '',
      tableName: firstNode?.data.tableName ?? '',
      column: firstColumn?.name ?? '',
      operator: '=',
      value: '',
      enabled: true,
    };

    set((s) => ({ whereFilters: [...s.whereFilters, newFilter] }));
  },

  updateWhereFilter: (id, updates) => {
    set((s) => ({
      whereFilters: s.whereFilters.map((f) => {
        if (f.id !== id) return f;
        const updated = { ...f, ...updates };
        // If nodeId changed, update tableName from the node
        if (updates.nodeId) {
          const node = get().nodes.find((n) => n.id === updates.nodeId);
          if (node) {
            updated.tableName = node.data.tableName;
          }
        }
        return updated;
      }),
    }));
  },

  removeWhereFilter: (id) => {
    set((s) => ({
      whereFilters: s.whereFilters.filter((f) => f.id !== id),
    }));
  },

  setGroupBy: (columns) => {
    set({ groupByColumns: columns });
  },

  addOrderBy: (table, column, direction) => {
    set((s) => ({
      orderByColumns: [
        ...s.orderByColumns,
        { table, column, direction: direction as 'ASC' | 'DESC' },
      ],
    }));
  },

  removeOrderBy: (index) => {
    set((s) => ({
      orderByColumns: s.orderByColumns.filter((_, i) => i !== index),
    }));
  },

  setLimit: (limit) => {
    set({ limit });
  },

  setDistinct: (distinct) => {
    set({ distinct });
  },

  generateSQL: () => {
    const state = get();
    const { nodes, joins, whereFilters, groupByColumns, orderByColumns, limit, distinct } = state;

    if (nodes.length === 0) return '';

    // Build alias map: nodeId -> alias (t0, t1, t2...)
    const aliasMap = new Map<string, string>();
    const tableNameMap = new Map<string, string>(); // nodeId -> tableName
    nodes.forEach((node, index) => {
      aliasMap.set(node.id, `t${index}`);
      tableNameMap.set(node.id, node.data.tableName);
    });

    // Collect selected columns
    const selectColumns: string[] = [];
    for (const node of nodes) {
      const alias = aliasMap.get(node.id)!;
      const selected = node.data.selectedColumns;
      if (selected.length === 0) continue;
      if (selected.length === node.data.columns.length) {
        // All columns selected: use alias.*
        selectColumns.push(`${alias}.*`);
      } else {
        for (const col of selected) {
          selectColumns.push(`${alias}.${col}`);
        }
      }
    }

    if (selectColumns.length === 0) return '-- No columns selected';

    // SELECT clause
    const distinctStr = distinct ? 'DISTINCT ' : '';
    let sql = `SELECT ${distinctStr}${selectColumns.join(', ')}`;

    // FROM clause - first table
    const firstNode = nodes[0];
    const firstAlias = aliasMap.get(firstNode.id)!;
    sql += `\nFROM ${firstNode.data.tableName} AS ${firstAlias}`;

    // JOIN clauses - follow join order
    const joinedNodeIds = new Set<string>([firstNode.id]);
    for (const join of joins) {
      const sourceAlias = aliasMap.get(join.sourceNodeId);
      const targetAlias = aliasMap.get(join.targetNodeId);
      const sourceTable = tableNameMap.get(join.sourceNodeId);
      const targetTable = tableNameMap.get(join.targetNodeId);

      if (!sourceAlias || !targetAlias || !sourceTable || !targetTable) continue;

      // Determine which side is already in FROM and which to JOIN
      let joinTable: string;
      let joinAlias: string;
      let leftAlias: string;
      let leftCol: string;
      let rightAlias: string;
      let rightCol: string;

      if (joinedNodeIds.has(join.sourceNodeId) && !joinedNodeIds.has(join.targetNodeId)) {
        joinTable = targetTable;
        joinAlias = targetAlias;
        leftAlias = sourceAlias;
        leftCol = join.sourceColumn;
        rightAlias = targetAlias;
        rightCol = join.targetColumn;
        joinedNodeIds.add(join.targetNodeId);
      } else if (joinedNodeIds.has(join.targetNodeId) && !joinedNodeIds.has(join.sourceNodeId)) {
        joinTable = sourceTable;
        joinAlias = sourceAlias;
        leftAlias = targetAlias;
        leftCol = join.targetColumn;
        rightAlias = sourceAlias;
        rightCol = join.sourceColumn;
        joinedNodeIds.add(join.sourceNodeId);
      } else {
        // Both already joined, or neither - just add target
        joinTable = targetTable;
        joinAlias = targetAlias;
        leftAlias = sourceAlias;
        leftCol = join.sourceColumn;
        rightAlias = targetAlias;
        rightCol = join.targetColumn;
        joinedNodeIds.add(join.targetNodeId);
      }

      const joinTypeStr = join.joinType === 'FULL' ? 'FULL OUTER' : join.joinType;
      sql += `\n${joinTypeStr} JOIN ${joinTable} AS ${joinAlias} ON ${leftAlias}.${leftCol} = ${rightAlias}.${rightCol}`;
    }

    // Add remaining tables that are not joined (implicit cross join / comma-separated)
    for (const node of nodes) {
      if (!joinedNodeIds.has(node.id)) {
        const alias = aliasMap.get(node.id)!;
        sql += `, ${node.data.tableName} AS ${alias}`;
        joinedNodeIds.add(node.id);
      }
    }

    // WHERE clause
    const enabledFilters = whereFilters.filter((f) => f.enabled && f.column);
    if (enabledFilters.length > 0) {
      const conditions = enabledFilters.map((f) => {
        const alias = aliasMap.get(f.nodeId) ?? f.tableName;
        if (f.operator === 'IS NULL') {
          return `${alias}.${f.column} IS NULL`;
        }
        if (f.operator === 'IS NOT NULL') {
          return `${alias}.${f.column} IS NOT NULL`;
        }
        if (f.operator === 'IN') {
          return `${alias}.${f.column} IN (${f.value})`;
        }
        // Determine if value needs quoting (simple heuristic: if it's not a number, quote it)
        const isNumeric = /^-?\d+(\.\d+)?$/.test(f.value);
        const val = isNumeric ? f.value : `'${f.value.replace(/'/g, "''")}'`;
        return `${alias}.${f.column} ${f.operator} ${val}`;
      });
      sql += `\nWHERE ${conditions.join(' AND ')}`;
    }

    // GROUP BY clause
    if (groupByColumns.length > 0) {
      const groupByParts = groupByColumns.map((col) => {
        // Format: "tableName.columnName" -> "alias.columnName"
        const dotIndex = col.indexOf('.');
        if (dotIndex !== -1) {
          const tbl = col.substring(0, dotIndex);
          const colName = col.substring(dotIndex + 1);
          // Find node by table name to get alias
          const node = nodes.find((n) => n.data.tableName === tbl);
          if (node) {
            const alias = aliasMap.get(node.id)!;
            return `${alias}.${colName}`;
          }
        }
        return col;
      });
      sql += `\nGROUP BY ${groupByParts.join(', ')}`;
    }

    // ORDER BY clause
    if (orderByColumns.length > 0) {
      const orderByParts = orderByColumns.map((o) => {
        const node = nodes.find((n) => n.data.tableName === o.table);
        const alias = node ? aliasMap.get(node.id)! : o.table;
        return `${alias}.${o.column} ${o.direction}`;
      });
      sql += `\nORDER BY ${orderByParts.join(', ')}`;
    }

    // LIMIT clause
    if (limit !== null && limit > 0) {
      sql += `\nLIMIT ${limit}`;
    }

    return sql;
  },

  reset: () => {
    set({
      nodes: [],
      edges: [],
      joins: [],
      whereFilters: [],
      groupByColumns: [],
      orderByColumns: [],
      limit: 500,
      distinct: false,
    });
  },
}));
