import type { TableInfo, TableStructure } from '@/lib/types';
import { formatDataType } from './utils';

export type FlatNode =
  | {
      kind: 'db';
      key: string;
      depth: number;
      db: string;
      expanded: boolean;
      tableCount: number;
      sizeBytes: number | null;
    }
  | {
      kind: 'table';
      key: string;
      depth: number;
      db: string;
      table: string;
      expanded: boolean;
      loading: boolean;
      isView: boolean;
      rowCountEstimate: number | null;
      sizeBytes: number | null;
      comment: string | null;
    }
  | {
      kind: 'column';
      key: string;
      depth: number;
      db: string;
      table: string;
      name: string;
      dataType: string;
      nullable: boolean;
      isPk: boolean;
      isFk: boolean;
      ordinalPosition: number;
      defaultValue: string | null;
      comment: string | null;
    };

export interface FlattenSidebarTreeArgs {
  /** flat = single active database (no db rows) */
  mode: 'flat' | 'nested';
  databases: string[];
  tablesByDb: Record<string, TableInfo[] | undefined>;
  expandedDbs: ReadonlySet<string>;
  /** keys `${db}.${table}` */
  expandedTables: ReadonlySet<string>;
  structures: Record<string, TableStructure | undefined>;
  structureLoading: Record<string, boolean | undefined>;
  dbSizes?: Record<string, number | null | undefined>;
  /** search-driven expansion, applied on top of expandedTables */
  autoExpandTables?: ReadonlySet<string>;
}

export function flattenSidebarTree(args: FlattenSidebarTreeArgs): FlatNode[] {
  const {
    mode, databases, tablesByDb, expandedDbs, expandedTables,
    structures, structureLoading, dbSizes, autoExpandTables,
  } = args;
  const nested = mode === 'nested';
  const nodes: FlatNode[] = [];

  for (const db of databases) {
    const tables = tablesByDb[db] ?? [];

    if (nested) {
      const dbExpanded = expandedDbs.has(db);
      nodes.push({
        kind: 'db',
        key: db,
        depth: 0,
        db,
        expanded: dbExpanded,
        tableCount: tables.length,
        sizeBytes: dbSizes?.[db] ?? null,
      });
      if (!dbExpanded) continue;
    }

    for (const table of tables) {
      const key = `${db}.${table.name}`;
      const loading = structureLoading[key] ?? false;
      const expanded = expandedTables.has(key) || (autoExpandTables?.has(key) ?? false);
      nodes.push({
        kind: 'table',
        key,
        depth: nested ? 1 : 0,
        db,
        table: table.name,
        expanded,
        loading,
        isView: table.table_type === 'View',
        rowCountEstimate: table.row_count_estimate,
        sizeBytes: table.size_bytes,
        comment: table.comment,
      });

      if (!expanded) continue;
      const structure = structures[key];
      if (!structure) continue;

      const fkColumns = new Set(structure.foreign_keys?.flatMap((fk) => fk.columns) ?? []);
      for (const column of structure.columns) {
        nodes.push({
          kind: 'column',
          key: `${key}.${column.ordinal_position}.${column.name}`,
          depth: nested ? 2 : 1,
          db,
          table: table.name,
          name: column.name,
          dataType: formatDataType(column.data_type),
          nullable: column.nullable,
          isPk: column.is_primary_key,
          isFk: fkColumns.has(column.name),
          ordinalPosition: column.ordinal_position,
          defaultValue: column.default_value,
          comment: column.comment,
        });
      }
    }
  }

  return nodes;
}
