import { create } from 'zustand';
import type { TableStructure } from '@/lib/types';

// === Types ===

export interface ColumnDefinition {
  id: string;
  name: string;
  type: string;
  length: string;
  nullable: boolean;
  defaultValue: string;
  isPrimaryKey: boolean;
  isUnique: boolean;
  autoIncrement: boolean;
  comment: string;
}

export type SqlDialect = 'mysql' | 'postgresql' | 'sqlite';

interface TableDesignerState {
  tableName: string;
  columns: ColumnDefinition[];
  isEditing: boolean;
  originalStructure: TableStructure | null;
  dialect: SqlDialect;

  setTableName: (name: string) => void;
  setDialect: (dialect: SqlDialect) => void;
  addColumn: () => void;
  removeColumn: (id: string) => void;
  updateColumn: (id: string, updates: Partial<ColumnDefinition>) => void;
  moveColumn: (id: string, direction: 'up' | 'down') => void;
  loadFromStructure: (structure: TableStructure) => void;
  reset: () => void;
  generateDDL: () => string;
}

// === Helpers ===

function createEmptyColumn(): ColumnDefinition {
  return {
    id: crypto.randomUUID(),
    name: '',
    type: '',
    length: '',
    nullable: true,
    defaultValue: '',
    isPrimaryKey: false,
    isUnique: false,
    autoIncrement: false,
    comment: '',
  };
}

function quoteIdentifier(name: string, dialect: SqlDialect): string {
  if (!name) return '""';
  const safe = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
  switch (dialect) {
    case 'mysql':
      return safe ? name : `\`${name.replace(/`/g, '``')}\``;
    case 'postgresql':
      return safe ? name : `"${name.replace(/"/g, '""')}"`;
    case 'sqlite':
      return safe ? name : `"${name.replace(/"/g, '""')}"`;
  }
}

function buildColumnType(col: ColumnDefinition): string {
  if (!col.type) return 'TEXT';
  if (col.length) return `${col.type}(${col.length})`;
  return col.type;
}

function buildColumnDef(col: ColumnDefinition, dialect: SqlDialect): string {
  const parts: string[] = [];
  parts.push(quoteIdentifier(col.name, dialect));
  parts.push(buildColumnType(col));

  if (col.autoIncrement) {
    switch (dialect) {
      case 'mysql':
        parts.push('AUTO_INCREMENT');
        break;
      case 'postgresql':
        // For PostgreSQL, replace type with SERIAL/BIGSERIAL
        // But since type is free-text, add GENERATED as fallback
        parts.push('GENERATED ALWAYS AS IDENTITY');
        break;
      case 'sqlite':
        // SQLite autoincrement only works with INTEGER PRIMARY KEY
        break;
    }
  }

  if (!col.nullable) {
    parts.push('NOT NULL');
  }

  if (col.defaultValue) {
    parts.push(`DEFAULT ${col.defaultValue}`);
  }

  if (col.comment && dialect === 'mysql') {
    parts.push(`COMMENT '${col.comment.replace(/'/g, "''")}'`);
  }

  return parts.join(' ');
}

function generateCreateTableDDL(
  tableName: string,
  columns: ColumnDefinition[],
  dialect: SqlDialect,
): string {
  const validColumns = columns.filter((c) => c.name.trim() !== '');
  if (validColumns.length === 0) return '-- No columns defined';

  const tbl = quoteIdentifier(tableName || 'untitled', dialect);
  const colDefs = validColumns.map((col) => `  ${buildColumnDef(col, dialect)}`);

  // Primary key constraint
  const pkColumns = validColumns.filter((c) => c.isPrimaryKey);
  if (pkColumns.length > 0) {
    const pkCols = pkColumns.map((c) => quoteIdentifier(c.name, dialect)).join(', ');
    if (dialect === 'sqlite' && pkColumns.length === 1 && pkColumns[0].autoIncrement) {
      // SQLite: INTEGER PRIMARY KEY AUTOINCREMENT must be inline
      const pkCol = pkColumns[0];
      const idx = validColumns.findIndex((c) => c.id === pkCol.id);
      if (idx >= 0) {
        colDefs[idx] = `  ${quoteIdentifier(pkCol.name, dialect)} ${buildColumnType(pkCol)} PRIMARY KEY AUTOINCREMENT`;
        if (!pkCol.nullable) {
          colDefs[idx] += ' NOT NULL';
        }
        if (pkCol.defaultValue) {
          colDefs[idx] += ` DEFAULT ${pkCol.defaultValue}`;
        }
      }
    } else {
      colDefs.push(`  PRIMARY KEY (${pkCols})`);
    }
  }

  // Unique constraints
  const uniqueColumns = validColumns.filter((c) => c.isUnique && !c.isPrimaryKey);
  for (const col of uniqueColumns) {
    colDefs.push(`  UNIQUE (${quoteIdentifier(col.name, dialect)})`);
  }

  const lines = [
    `CREATE TABLE ${tbl} (`,
    colDefs.join(',\n'),
    ');',
  ];

  // Add column comments for PostgreSQL (must be separate statements)
  if (dialect === 'postgresql') {
    const commentStmts = validColumns
      .filter((c) => c.comment)
      .map(
        (c) =>
          `COMMENT ON COLUMN ${tbl}.${quoteIdentifier(c.name, dialect)} IS '${c.comment.replace(/'/g, "''")}';`,
      );
    if (commentStmts.length > 0) {
      lines.push('');
      lines.push(...commentStmts);
    }
  }

  return lines.join('\n');
}

function generateAlterTableDDL(
  tableName: string,
  columns: ColumnDefinition[],
  originalStructure: TableStructure,
  dialect: SqlDialect,
): string {
  const statements: string[] = [];
  const tbl = quoteIdentifier(tableName || originalStructure.table_ref.table, dialect);
  const validColumns = columns.filter((c) => c.name.trim() !== '');

  // Rename table if name changed
  if (tableName && tableName !== originalStructure.table_ref.table) {
    switch (dialect) {
      case 'mysql':
        statements.push(
          `ALTER TABLE ${quoteIdentifier(originalStructure.table_ref.table, dialect)} RENAME TO ${tbl};`,
        );
        break;
      case 'postgresql':
        statements.push(
          `ALTER TABLE ${quoteIdentifier(originalStructure.table_ref.table, dialect)} RENAME TO ${tbl};`,
        );
        break;
      case 'sqlite':
        statements.push(
          `ALTER TABLE ${quoteIdentifier(originalStructure.table_ref.table, dialect)} RENAME TO ${tbl};`,
        );
        break;
    }
  }

  const originalColumnNames = new Set(originalStructure.columns.map((c) => c.name));
  const newColumnNames = new Set(validColumns.map((c) => c.name));
  const originalColumnMap = new Map(originalStructure.columns.map((c) => [c.name, c]));

  // Dropped columns
  for (const origName of originalColumnNames) {
    if (!newColumnNames.has(origName)) {
      statements.push(`ALTER TABLE ${tbl} DROP COLUMN ${quoteIdentifier(origName, dialect)};`);
    }
  }

  // Added columns
  for (const col of validColumns) {
    if (!originalColumnNames.has(col.name)) {
      statements.push(
        `ALTER TABLE ${tbl} ADD COLUMN ${buildColumnDef(col, dialect)};`,
      );
    }
  }

  // Modified columns
  for (const col of validColumns) {
    const orig = originalColumnMap.get(col.name);
    if (!orig) continue;

    const typeChanged = buildColumnType(col).toLowerCase() !== orig.data_type.toLowerCase();
    const nullableChanged = col.nullable !== orig.nullable;
    const defaultChanged = (col.defaultValue || '') !== (orig.default_value || '');
    const commentChanged = (col.comment || '') !== (orig.comment || '');

    if (typeChanged || nullableChanged || defaultChanged || commentChanged) {
      switch (dialect) {
        case 'mysql':
          statements.push(
            `ALTER TABLE ${tbl} MODIFY COLUMN ${buildColumnDef(col, dialect)};`,
          );
          break;
        case 'postgresql': {
          if (typeChanged) {
            statements.push(
              `ALTER TABLE ${tbl} ALTER COLUMN ${quoteIdentifier(col.name, dialect)} TYPE ${buildColumnType(col)};`,
            );
          }
          if (nullableChanged) {
            statements.push(
              `ALTER TABLE ${tbl} ALTER COLUMN ${quoteIdentifier(col.name, dialect)} ${col.nullable ? 'DROP NOT NULL' : 'SET NOT NULL'};`,
            );
          }
          if (defaultChanged) {
            if (col.defaultValue) {
              statements.push(
                `ALTER TABLE ${tbl} ALTER COLUMN ${quoteIdentifier(col.name, dialect)} SET DEFAULT ${col.defaultValue};`,
              );
            } else {
              statements.push(
                `ALTER TABLE ${tbl} ALTER COLUMN ${quoteIdentifier(col.name, dialect)} DROP DEFAULT;`,
              );
            }
          }
          if (commentChanged && col.comment) {
            statements.push(
              `COMMENT ON COLUMN ${tbl}.${quoteIdentifier(col.name, dialect)} IS '${col.comment.replace(/'/g, "''")}';`,
            );
          }
          break;
        }
        case 'sqlite':
          // SQLite has very limited ALTER TABLE support
          statements.push(
            `-- SQLite does not support MODIFY COLUMN. Column "${col.name}" changes require table recreation.`,
          );
          break;
      }
    }
  }

  // Handle primary key changes
  const origPkCols = originalStructure.primary_key?.columns ?? [];
  const newPkCols = validColumns.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const pkChanged =
    origPkCols.length !== newPkCols.length ||
    origPkCols.some((c, i) => c !== newPkCols[i]);

  if (pkChanged && dialect !== 'sqlite') {
    if (origPkCols.length > 0) {
      if (dialect === 'mysql') {
        statements.push(`ALTER TABLE ${tbl} DROP PRIMARY KEY;`);
      } else {
        const pkName = originalStructure.primary_key?.name;
        if (pkName) {
          statements.push(`ALTER TABLE ${tbl} DROP CONSTRAINT ${quoteIdentifier(pkName, dialect)};`);
        }
      }
    }
    if (newPkCols.length > 0) {
      const pkColList = newPkCols.map((c) => quoteIdentifier(c, dialect)).join(', ');
      statements.push(`ALTER TABLE ${tbl} ADD PRIMARY KEY (${pkColList});`);
    }
  }

  if (statements.length === 0) {
    return '-- No changes detected';
  }

  return statements.join('\n');
}

// === Common type suggestions ===

export const COMMON_TYPES: Record<SqlDialect, string[]> = {
  mysql: [
    'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'MEDIUMINT',
    'DECIMAL', 'FLOAT', 'DOUBLE',
    'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT', 'TINYTEXT',
    'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
    'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
    'BOOLEAN', 'BIT',
    'JSON', 'ENUM', 'SET',
    'BINARY', 'VARBINARY',
    'UUID',
  ],
  postgresql: [
    'INTEGER', 'BIGINT', 'SMALLINT', 'SERIAL', 'BIGSERIAL',
    'NUMERIC', 'REAL', 'DOUBLE PRECISION',
    'VARCHAR', 'CHAR', 'TEXT',
    'BOOLEAN',
    'DATE', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIME', 'TIMETZ', 'INTERVAL',
    'JSON', 'JSONB',
    'UUID',
    'BYTEA',
    'INET', 'CIDR', 'MACADDR',
    'ARRAY', 'HSTORE',
    'MONEY',
    'XML',
  ],
  sqlite: [
    'INTEGER', 'REAL', 'TEXT', 'BLOB', 'NUMERIC',
    'BOOLEAN', 'DATE', 'DATETIME', 'TIMESTAMP',
    'VARCHAR', 'CHAR', 'FLOAT', 'DOUBLE',
    'BIGINT', 'SMALLINT', 'TINYINT',
    'DECIMAL', 'JSON',
  ],
};

// === Store ===

export const useTableDesignerStore = create<TableDesignerState>((set, get) => ({
  tableName: '',
  columns: [createEmptyColumn()],
  isEditing: false,
  originalStructure: null,
  dialect: 'mysql',

  setTableName: (name) => set({ tableName: name }),

  setDialect: (dialect) => set({ dialect }),

  addColumn: () => {
    set((s) => ({
      columns: [...s.columns, createEmptyColumn()],
    }));
  },

  removeColumn: (id) => {
    set((s) => {
      const columns = s.columns.filter((c) => c.id !== id);
      // Always keep at least one column row
      return { columns: columns.length > 0 ? columns : [createEmptyColumn()] };
    });
  },

  updateColumn: (id, updates) => {
    set((s) => ({
      columns: s.columns.map((c) => {
        if (c.id !== id) return c;
        const updated = { ...c, ...updates };
        // If setting as primary key, auto-set not nullable
        if (updates.isPrimaryKey === true) {
          updated.nullable = false;
        }
        return updated;
      }),
    }));
  },

  moveColumn: (id, direction) => {
    set((s) => {
      const idx = s.columns.findIndex((c) => c.id === id);
      if (idx < 0) return s;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= s.columns.length) return s;
      const columns = [...s.columns];
      [columns[idx], columns[newIdx]] = [columns[newIdx], columns[idx]];
      return { columns };
    });
  },

  loadFromStructure: (structure) => {
    const columns: ColumnDefinition[] = structure.columns
      .sort((a, b) => a.ordinal_position - b.ordinal_position)
      .map((col) => {
        // Parse type and length from data_type (e.g., "varchar(255)" -> type="VARCHAR", length="255")
        const typeMatch = col.data_type.match(/^([a-zA-Z\s]+?)(?:\((.+)\))?$/);
        const typeName = typeMatch ? typeMatch[1].trim().toUpperCase() : col.data_type.toUpperCase();
        const length = typeMatch && typeMatch[2] ? typeMatch[2] : '';

        // Determine if column is unique from indexes
        const isUnique = structure.indexes.some(
          (idx) => idx.is_unique && !idx.is_primary && idx.columns.length === 1 && idx.columns[0] === col.name,
        );

        // Determine autoincrement from default_value patterns
        const autoIncrement =
          (col.default_value?.toLowerCase().includes('auto_increment')) ||
          (col.default_value?.toLowerCase().includes('nextval')) ||
          false;

        return {
          id: crypto.randomUUID(),
          name: col.name,
          type: typeName,
          length,
          nullable: col.nullable,
          defaultValue: col.default_value ?? '',
          isPrimaryKey: col.is_primary_key,
          isUnique,
          autoIncrement,
          comment: col.comment ?? '',
        };
      });

    set({
      tableName: structure.table_ref.table,
      columns: columns.length > 0 ? columns : [createEmptyColumn()],
      isEditing: true,
      originalStructure: structure,
    });
  },

  reset: () => {
    set({
      tableName: '',
      columns: [createEmptyColumn()],
      isEditing: false,
      originalStructure: null,
    });
  },

  generateDDL: () => {
    const { tableName, columns, isEditing, originalStructure, dialect } = get();

    if (isEditing && originalStructure) {
      return generateAlterTableDDL(tableName, columns, originalStructure, dialect);
    }

    return generateCreateTableDDL(tableName, columns, dialect);
  },
}));
