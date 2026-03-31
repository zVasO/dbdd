import React, { useMemo } from 'react';
import { Columns3, Eye, Key, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TableInfo, ColumnInfo } from '@/lib/types';
import { formatDataType, HighlightMatch } from './utils';
import { DatabaseNode } from './DatabaseNode';

export interface SearchableTreeProps {
  databases: { name: string; size_bytes: number | null }[];
  tables: Record<string, TableInfo[]>;
  structures: Record<string, { columns: ColumnInfo[] }>;
  structureLoading: Record<string, boolean>;
  searchQuery: string;
  expandedDbs: Set<string>;
  expandedTables: Set<string>;
  selectedColumn: ColumnInfo | null;
  onToggleDb: (db: string) => void;
  onToggleTable: (db: string, table: string) => void;
  onTableClick: (db: string, table: string) => void;
  onColumnClick: (column: ColumnInfo) => void;
  onTruncateTable: (db: string, table: string) => void;
  onDropTable: (db: string, table: string) => void;
  onRenameTable: (db: string, table: string) => void;
  isFavorite?: (table: string) => boolean;
  onToggleFavorite?: (table: string) => void;
  onColumnDoubleClick?: (db: string, tableName: string, colName: string) => void;
}

export function SearchableTree({
  databases, tables, structures, structureLoading,
  searchQuery, expandedDbs, expandedTables, selectedColumn,
  onToggleDb, onToggleTable, onTableClick, onColumnClick,
  onTruncateTable, onDropTable, onRenameTable,
  isFavorite, onToggleFavorite, onColumnDoubleClick,
}: SearchableTreeProps) {
  const q = searchQuery.toLowerCase().trim();

  // Compute which tables have matching columns (from loaded structures)
  const tableColumnMatches = useMemo(() => {
    if (!q) return new Set<string>();
    const matches = new Set<string>();
    for (const [key, structure] of Object.entries(structures)) {
      if (structure.columns.some((col) => col.name.toLowerCase().includes(q))) {
        matches.add(key);
      }
    }
    return matches;
  }, [q, structures]);

  // ─── Search mode: flat grouped results (tables first, then columns) ────────
  const searchResults = useMemo(() => {
    if (!q) return null;

    const matchingTables: { db: string; table: TableInfo }[] = [];
    const matchingColumns: { db: string; tableName: string; column: ColumnInfo }[] = [];

    for (const db of databases) {
      const dbTables = tables[db.name] ?? [];
      for (const t of dbTables) {
        if (t.name.toLowerCase().includes(q)) {
          matchingTables.push({ db: db.name, table: t });
        }
        const key = `${db.name}.${t.name}`;
        const cols = structures[key]?.columns;
        if (cols) {
          for (const col of cols) {
            if (col.name.toLowerCase().includes(q)) {
              matchingColumns.push({ db: db.name, tableName: t.name, column: col });
            }
          }
        }
      }
    }

    return { matchingTables, matchingColumns };
  }, [q, databases, tables, structures]);

  // ─── Normal tree mode (no search) ──────────────────────────────────────────
  const filteredData = useMemo(() => {
    if (q) return [];
    return databases.map((db) => ({
      db,
      filteredTables: tables[db.name] ?? [],
      hasMatch: true,
    }));
  }, [databases, tables, q]);

  // Search mode: flat grouped list
  if (searchResults) {
    const { matchingTables, matchingColumns } = searchResults;

    if (matchingTables.length === 0 && matchingColumns.length === 0) {
      return (
        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
          No results for &ldquo;{searchQuery}&rdquo;
        </p>
      );
    }

    return (
      <div className="space-y-1">
        {/* Tables section */}
        {matchingTables.length > 0 && (
          <div>
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Tables
              <span className="ml-1 font-normal">({matchingTables.length})</span>
            </div>
            {matchingTables.map(({ db, table }) => {
              const isView = table.table_type === 'View';
              const Icon = isView ? Eye : Table2;
              return (
                <button
                  key={`${db}.${table.name}`}
                  onClick={() => onTableClick(db, table.name)}
                  className="flex w-full items-center gap-1.5 rounded-sm px-3 py-1 text-left text-xs hover:bg-sidebar-accent"
                >
                  <Icon className={cn('h-3.5 w-3.5 shrink-0', isView ? 'text-accent-foreground' : 'text-muted-foreground')} />
                  <span className="truncate text-sidebar-foreground">
                    <HighlightMatch text={table.name} query={q} />
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{db}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Columns section */}
        {matchingColumns.length > 0 && (
          <div>
            <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Columns
              <span className="ml-1 font-normal">({matchingColumns.length})</span>
            </div>
            {matchingColumns.map(({ db, tableName, column }) => (
              <button
                key={`${db}.${tableName}.${column.name}`}
                onClick={() => onColumnClick(column)}
                onDoubleClick={() => onColumnDoubleClick ? onColumnDoubleClick(db, tableName, column.name) : onTableClick(db, tableName)}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-sm px-3 py-0.5 text-left text-[11px] hover:bg-sidebar-accent',
                  selectedColumn?.name === column.name &&
                    selectedColumn?.ordinal_position === column.ordinal_position &&
                    'bg-sidebar-accent',
                )}
              >
                {column.is_primary_key ? (
                  <Key className="h-3 w-3 shrink-0 text-primary" />
                ) : (
                  <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate italic text-muted-foreground">
                  <HighlightMatch text={column.name} query={q} />
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span>{formatDataType(column.data_type)}</span>
                  <span className="text-muted-foreground/50">{tableName}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Normal tree mode
  return (
    <>
      {filteredData.map(({ db, filteredTables }) => (
        <DatabaseNode
          key={db.name}
          name={db.name}
          sizeBytes={db.size_bytes}
          expanded={expandedDbs.has(db.name)}
          onToggle={() => onToggleDb(db.name)}
          tables={filteredTables}
          expandedTables={expandedTables}
          structures={structures}
          structureLoading={structureLoading}
          dbName={db.name}
          onToggleTable={onToggleTable}
          onTableClick={onTableClick}
          onColumnClick={onColumnClick}
          selectedColumn={selectedColumn}
          searchQuery=""
          tableColumnMatches={tableColumnMatches}
          onTruncateTable={onTruncateTable}
          onDropTable={onDropTable}
          onRenameTable={onRenameTable}
          isFavorite={isFavorite}
          onToggleFavorite={onToggleFavorite}
          onColumnDoubleClick={onColumnDoubleClick ? (tableName, colName) => onColumnDoubleClick(db.name, tableName, colName) : undefined}
        />
      ))}
    </>
  );
}
