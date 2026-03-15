import { create } from 'zustand';
import { ipc, extractErrorMessage } from '@/lib/ipc';
import type { TableStructure, ColumnInfo } from '@/lib/types';

// === Types ===

export interface ColumnDiff {
  type: 'added' | 'removed' | 'modified';
  columnName: string;
  sourceType?: string;
  targetType?: string;
  sourceNullable?: boolean;
  targetNullable?: boolean;
  sourceDefault?: string | null;
  targetDefault?: string | null;
}

export interface TableDiff {
  type: 'added' | 'removed' | 'modified';
  tableName: string;
  columns?: ColumnDiff[];
}

interface MigrationState {
  sourceConnectionId: string | null;
  targetConnectionId: string | null;
  sourceDatabase: string | null;
  targetDatabase: string | null;
  sourceTables: TableStructure[];
  targetTables: TableStructure[];
  diff: TableDiff[];
  migrationSQL: string[];
  loading: boolean;
  error: string | null;

  setSource: (connectionId: string | null, database: string | null) => void;
  setTarget: (connectionId: string | null, database: string | null) => void;
  computeDiff: () => Promise<void>;
  generateMigration: () => void;
  reset: () => void;
}

// === Helpers ===

function compareColumns(
  sourceColumns: ColumnInfo[],
  targetColumns: ColumnInfo[],
): ColumnDiff[] {
  const diffs: ColumnDiff[] = [];
  const sourceMap = new Map(sourceColumns.map((c) => [c.name, c]));
  const targetMap = new Map(targetColumns.map((c) => [c.name, c]));

  // Columns in source but not in target => added (need to be created in target)
  for (const [name, srcCol] of sourceMap) {
    const tgtCol = targetMap.get(name);
    if (!tgtCol) {
      diffs.push({
        type: 'added',
        columnName: name,
        sourceType: srcCol.data_type,
        sourceNullable: srcCol.nullable,
        sourceDefault: srcCol.default_value,
      });
    } else {
      // Both exist — check for modifications
      const typeChanged = srcCol.data_type.toLowerCase() !== tgtCol.data_type.toLowerCase();
      const nullableChanged = srcCol.nullable !== tgtCol.nullable;
      const defaultChanged = (srcCol.default_value ?? '') !== (tgtCol.default_value ?? '');

      if (typeChanged || nullableChanged || defaultChanged) {
        diffs.push({
          type: 'modified',
          columnName: name,
          sourceType: srcCol.data_type,
          targetType: tgtCol.data_type,
          sourceNullable: srcCol.nullable,
          targetNullable: tgtCol.nullable,
          sourceDefault: srcCol.default_value,
          targetDefault: tgtCol.default_value,
        });
      }
    }
  }

  // Columns in target but not in source => removed (exist in target but not in source)
  for (const [name, tgtCol] of targetMap) {
    if (!sourceMap.has(name)) {
      diffs.push({
        type: 'removed',
        columnName: name,
        targetType: tgtCol.data_type,
        targetNullable: tgtCol.nullable,
        targetDefault: tgtCol.default_value,
      });
    }
  }

  return diffs;
}

function generateCreateTable(tableName: string, columns: ColumnInfo[]): string {
  const colDefs = columns.map((col) => {
    let def = `  ${quoteIdent(col.name)} ${col.data_type}`;
    if (!col.nullable) def += ' NOT NULL';
    if (col.default_value) def += ` DEFAULT ${col.default_value}`;
    if (col.is_primary_key) def += ' PRIMARY KEY';
    return def;
  });
  return `CREATE TABLE ${quoteIdent(tableName)} (\n${colDefs.join(',\n')}\n);`;
}

function generateDropTable(tableName: string): string {
  return `DROP TABLE IF EXISTS ${quoteIdent(tableName)};`;
}

function generateAlterStatements(
  tableName: string,
  columnDiffs: ColumnDiff[],
): string[] {
  const statements: string[] = [];
  const tbl = quoteIdent(tableName);

  for (const diff of columnDiffs) {
    const col = quoteIdent(diff.columnName);

    switch (diff.type) {
      case 'added': {
        let stmt = `ALTER TABLE ${tbl} ADD COLUMN ${col} ${diff.sourceType ?? 'TEXT'}`;
        if (diff.sourceNullable === false) stmt += ' NOT NULL';
        if (diff.sourceDefault) stmt += ` DEFAULT ${diff.sourceDefault}`;
        statements.push(`${stmt};`);
        break;
      }
      case 'removed': {
        statements.push(`ALTER TABLE ${tbl} DROP COLUMN ${col};`);
        break;
      }
      case 'modified': {
        // Use MODIFY COLUMN (MySQL) / ALTER COLUMN (Postgres) — using generic syntax
        let stmt = `ALTER TABLE ${tbl} MODIFY COLUMN ${col} ${diff.sourceType ?? 'TEXT'}`;
        if (diff.sourceNullable === false) stmt += ' NOT NULL';
        if (diff.sourceDefault) stmt += ` DEFAULT ${diff.sourceDefault}`;
        statements.push(`${stmt};`);
        break;
      }
    }
  }

  return statements;
}

function quoteIdent(name: string): string {
  // Simple identifier quoting — use backticks
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return name;
  return `\`${name.replace(/`/g, '``')}\``;
}

// === Store ===

export const useMigrationStore = create<MigrationState>((set, get) => ({
  sourceConnectionId: null,
  targetConnectionId: null,
  sourceDatabase: null,
  targetDatabase: null,
  sourceTables: [],
  targetTables: [],
  diff: [],
  migrationSQL: [],
  loading: false,
  error: null,

  setSource: (connectionId, database) => {
    set({
      sourceConnectionId: connectionId,
      sourceDatabase: database,
      sourceTables: [],
      diff: [],
      migrationSQL: [],
      error: null,
    });
  },

  setTarget: (connectionId, database) => {
    set({
      targetConnectionId: connectionId,
      targetDatabase: database,
      targetTables: [],
      diff: [],
      migrationSQL: [],
      error: null,
    });
  },

  computeDiff: async () => {
    const {
      sourceConnectionId,
      targetConnectionId,
      sourceDatabase,
      targetDatabase,
    } = get();

    if (!sourceConnectionId || !targetConnectionId) {
      set({ error: 'Both source and target connections are required.' });
      return;
    }
    if (!sourceDatabase || !targetDatabase) {
      set({ error: 'Both source and target databases are required.' });
      return;
    }

    set({ loading: true, error: null, diff: [], migrationSQL: [] });

    try {
      // Load tables for both connections
      const [sourceTableList, targetTableList] = await Promise.all([
        ipc.listTables(sourceConnectionId, sourceDatabase),
        ipc.listTables(targetConnectionId, targetDatabase),
      ]);

      // Load structures for all tables in both connections
      const sourceStructures = await Promise.all(
        sourceTableList.map((t) =>
          ipc.getTableStructure(sourceConnectionId, {
            database: sourceDatabase,
            schema: null,
            table: t.name,
          }),
        ),
      );

      const targetStructures = await Promise.all(
        targetTableList.map((t) =>
          ipc.getTableStructure(targetConnectionId, {
            database: targetDatabase,
            schema: null,
            table: t.name,
          }),
        ),
      );

      // Build maps by table name
      const sourceMap = new Map(
        sourceStructures.map((s) => [s.table_ref.table, s]),
      );
      const targetMap = new Map(
        targetStructures.map((s) => [s.table_ref.table, s]),
      );

      const diffs: TableDiff[] = [];

      // Tables in source but not in target => added
      for (const [name, srcTable] of sourceMap) {
        const tgtTable = targetMap.get(name);
        if (!tgtTable) {
          diffs.push({
            type: 'added',
            tableName: name,
            columns: srcTable.columns.map((col) => ({
              type: 'added' as const,
              columnName: col.name,
              sourceType: col.data_type,
              sourceNullable: col.nullable,
              sourceDefault: col.default_value,
            })),
          });
        } else {
          // Both exist — compare columns
          const colDiffs = compareColumns(srcTable.columns, tgtTable.columns);
          if (colDiffs.length > 0) {
            diffs.push({
              type: 'modified',
              tableName: name,
              columns: colDiffs,
            });
          }
        }
      }

      // Tables in target but not in source => removed
      for (const [name] of targetMap) {
        if (!sourceMap.has(name)) {
          diffs.push({
            type: 'removed',
            tableName: name,
          });
        }
      }

      // Sort diffs: added first, then modified, then removed
      diffs.sort((a, b) => {
        const order = { added: 0, modified: 1, removed: 2 };
        return order[a.type] - order[b.type];
      });

      set({
        sourceTables: sourceStructures,
        targetTables: targetStructures,
        diff: diffs,
        loading: false,
      });

      // Auto-generate migration SQL
      get().generateMigration();
    } catch (e) {
      set({ loading: false, error: extractErrorMessage(e) });
    }
  },

  generateMigration: () => {
    const { diff, sourceTables } = get();
    const statements: string[] = [];

    // Header comment
    statements.push('-- Schema Migration Script');
    statements.push(`-- Generated at ${new Date().toISOString()}`);
    statements.push('');

    for (const tableDiff of diff) {
      switch (tableDiff.type) {
        case 'added': {
          // Find the full source table structure to get all columns
          const sourceTable = sourceTables.find(
            (t) => t.table_ref.table === tableDiff.tableName,
          );
          if (sourceTable) {
            statements.push(`-- Create table: ${tableDiff.tableName}`);
            statements.push(
              generateCreateTable(tableDiff.tableName, sourceTable.columns),
            );
            statements.push('');
          }
          break;
        }
        case 'removed': {
          statements.push(`-- Drop table: ${tableDiff.tableName}`);
          statements.push(generateDropTable(tableDiff.tableName));
          statements.push('');
          break;
        }
        case 'modified': {
          if (tableDiff.columns && tableDiff.columns.length > 0) {
            statements.push(`-- Modify table: ${tableDiff.tableName}`);
            const alterStmts = generateAlterStatements(
              tableDiff.tableName,
              tableDiff.columns,
            );
            statements.push(...alterStmts);
            statements.push('');
          }
          break;
        }
      }
    }

    set({ migrationSQL: statements });
  },

  reset: () => {
    set({
      sourceConnectionId: null,
      targetConnectionId: null,
      sourceDatabase: null,
      targetDatabase: null,
      sourceTables: [],
      targetTables: [],
      diff: [],
      migrationSQL: [],
      loading: false,
      error: null,
    });
  },
}));
