import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useUIStore } from '@/stores/uiStore';
import { useActivityStore } from '@/stores/activityStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  ChevronRight,
  ChevronDown,
  Clock,
  Copy,
  Database,
  Hash,
  Info,
  Table2,
  Eye,
  Columns3,
  Key,
  Loader2,
  Search,
  Star,
  Terminal,
  Trash2,
  Eraser,
  Pencil,
  X,
  Check,
  Layers,
  Plus,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { useFavoritesStore } from '@/stores/favoritesStore';
import type { TableInfo, ColumnInfo } from '@/lib/types';

/** Safely convert data_type to string - backend may return objects like {Varchar: 255} */
function formatDataType(dt: unknown): string {
  if (typeof dt === 'string') return dt;
  if (dt && typeof dt === 'object') {
    const entries = Object.entries(dt as Record<string, unknown>);
    if (entries.length === 1) {
      const [key, val] = entries[0];
      if (val === null || val === undefined) return key.toLowerCase();
      return `${key.toLowerCase()}(${val})`;
    }
    return JSON.stringify(dt);
  }
  return String(dt ?? '');
}

interface SidebarProps {
  onOpenConnectionDialog?: () => void;
}

export const Sidebar = React.memo(function Sidebar({ onOpenConnectionDialog }: SidebarProps = {}) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const databases = useSchemaStore((s) => s.databases);
  const tables = useSchemaStore((s) => s.tables);
  const structures = useSchemaStore((s) => s.structures);
  const structureLoading = useSchemaStore((s) => s.structureLoading);
  const activeDatabase = useSchemaStore((s) => s.activeDatabase);
  const { loadTables, loadTableStructure, setActiveDatabase } = useSchemaStore.getState();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const tabs = useQueryStore((s) => s.tabs);
  const { createTab, updateSql, executeQuery, setActiveTab } = useQueryStore.getState();

  const getFavorites = useFavoritesStore((s) => s.getFavorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const isFavorite = useFavoritesStore((s) => s.isFavorite);
  const favorites = activeConnectionId ? getFavorites(activeConnectionId) : [];

  const getRecentTables = useActivityStore((s) => s.getRecentTables);
  const trackTableOpen = useActivityStore((s) => s.trackTableOpen);
  const recentTables = activeConnectionId ? getRecentTables(activeConnectionId) : [];

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [selectedColumn, setSelectedColumn] = useState<ColumnInfo | null>(null);
  const [dbSelectorOpen, setDbSelectorOpen] = useState(false);
  const dbSelectorRef = useRef<HTMLDivElement>(null);

  // Close DB selector on outside click
  useEffect(() => {
    if (!dbSelectorOpen) return;
    const handler = (e: MouseEvent) => {
      if (dbSelectorRef.current && !dbSelectorRef.current.contains(e.target as Node)) {
        setDbSelectorOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dbSelectorOpen]);

  if (!sidebarOpen) return null;

  const handleSelectDatabase = (dbName: string | null) => {
    setActiveDatabase(dbName);
    setDbSelectorOpen(false);
    // Auto-load tables when selecting a database
    if (dbName && activeConnectionId && !tables[dbName]) {
      loadTables(activeConnectionId, dbName);
    }
  };

  // Databases to show in the tree — scoped by activeDatabase
  const visibleDatabases = activeDatabase
    ? databases.filter((db) => db.name === activeDatabase)
    : databases;

  const toggleDb = (dbName: string) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
        if (activeConnectionId && !tables[dbName]) {
          loadTables(activeConnectionId, dbName);
        }
      }
      return next;
    });
  };

  const toggleTable = (dbName: string, tableName: string) => {
    const key = `${dbName}.${tableName}`;
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (activeConnectionId && !structures[key]) {
          loadTableStructure(activeConnectionId, {
            database: dbName,
            schema: null,
            table: tableName,
          });
        }
      }
      return next;
    });
  };

  const handleTableClick = (db: string, tableName: string) => {
    if (!activeConnectionId) return;
    trackTableOpen(activeConnectionId, tableName);
    // Reuse existing tab for same table + database
    const existing = tabs.find((t) => t.table === tableName && t.database === db);
    if (existing) {
      setActiveTab(existing.id);
      return;
    }
    const sql = `SELECT * FROM \`${tableName}\` LIMIT 500`;
    const tabId = createTab(tableName, { editorVisible: false, database: db, table: tableName });
    updateSql(tabId, sql);
    executeQuery(activeConnectionId, tabId);
  };

  const handleColumnClick = (column: ColumnInfo) => {
    setSelectedColumn((prev) =>
      prev?.name === column.name && prev?.ordinal_position === column.ordinal_position
        ? null
        : column,
    );
  };

  const handleTruncateTable = async (db: string, tableName: string) => {
    if (!activeConnectionId) return;
    if (!window.confirm(`Truncate table "${tableName}"? This will delete all rows.`)) return;
    try {
      await ipc.executeQuery(activeConnectionId, `TRUNCATE TABLE \`${tableName}\``);
      loadTables(activeConnectionId, db);
    } catch (err) {
      alert(`Failed to truncate: ${err}`);
    }
  };

  const handleDropTable = async (db: string, tableName: string) => {
    if (!activeConnectionId) return;
    if (!window.confirm(`DROP TABLE "${tableName}"? This action cannot be undone!`)) return;
    try {
      await ipc.executeQuery(activeConnectionId, `DROP TABLE \`${tableName}\``);
      loadTables(activeConnectionId, db);
    } catch (err) {
      alert(`Failed to drop: ${err}`);
    }
  };

  const handleRenameTable = async (db: string, tableName: string) => {
    if (!activeConnectionId) return;
    const newName = window.prompt(`Rename table "${tableName}" to:`, tableName);
    if (!newName || newName === tableName) return;
    try {
      await ipc.executeQuery(activeConnectionId, `ALTER TABLE \`${tableName}\` RENAME TO \`${newName}\``);
      loadTables(activeConnectionId, db);
    } catch (err) {
      alert(`Failed to rename: ${err}`);
    }
  };

  // Determine the active DB info for display
  const activeDbInfo = databases.find((db) => db.name === activeDatabase);
  const activeTables = activeDatabase ? (tables[activeDatabase] ?? []) : [];

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl text-sidebar-foreground"
        style={{ width: 'var(--sidebar-width)' }}
      >
        {/* Database selector — pl-[78px] reserves space for macOS traffic lights */}
        <div className="relative border-b border-sidebar-border" ref={dbSelectorRef}>
          <div className="flex items-center pl-[78px]">
          <button
            onClick={() => setDbSelectorOpen(!dbSelectorOpen)}
            className="flex flex-1 min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-sidebar-accent/50 transition-colors"
          >
            <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-sidebar-foreground">
                {activeDatabase ?? 'All Databases'}
              </div>
              {activeDatabase && activeDbInfo?.size_bytes != null && (
                <div className="text-[10px] text-muted-foreground">
                  {formatBytes(activeDbInfo.size_bytes)}
                  {activeTables.length > 0 && ` \u00b7 ${activeTables.length} tables`}
                </div>
              )}
              {!activeDatabase && databases.length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {databases.length} database{databases.length !== 1 ? 's' : ''}
                </div>
              )}
            </div>
            <ChevronDown className={cn(
              'h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200',
              dbSelectorOpen && 'rotate-180',
            )} />
          </button>
          {onOpenConnectionDialog && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onOpenConnectionDialog}
                  className="flex h-full shrink-0 items-center px-2 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent/50 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                Add connection
              </TooltipContent>
            </Tooltip>
          )}
          </div>

          {/* Dropdown */}
          {dbSelectorOpen && (
            <div className="absolute left-0 right-0 top-full z-50 max-h-64 overflow-y-auto border-b border-border bg-popover shadow-lg">
              {/* "All Databases" option */}
              <button
                onClick={() => handleSelectDatabase(null)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                  !activeDatabase && 'bg-accent',
                )}
              >
                <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 text-left">All Databases</span>
                {!activeDatabase && <Check className="h-3 w-3 text-primary" />}
              </button>

              <Separator />

              {databases.map((db) => (
                <button
                  key={db.name}
                  onClick={() => handleSelectDatabase(db.name)}
                  className={cn(
                    'flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-accent transition-colors',
                    activeDatabase === db.name && 'bg-accent',
                  )}
                >
                  <Database className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                  <span className="min-w-0 flex-1 truncate text-left">{db.name}</span>
                  {db.size_bytes != null && (
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatBytes(db.size_bytes)}
                    </span>
                  )}
                  {activeDatabase === db.name && <Check className="h-3 w-3 shrink-0 text-primary" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Search */}
        <div className="border-b border-sidebar-border px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-sm bg-sidebar-accent/50 px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              className="flex-1 bg-transparent text-xs text-sidebar-foreground placeholder:text-muted-foreground outline-none"
              placeholder="Search tables & columns..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-sidebar-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1 overflow-hidden">
          <div className="py-1">
            {/* Favorites section */}
            {favorites.length > 0 && !searchQuery && (
              <div className="px-2 py-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                  Favorites
                </div>
                {favorites.map((table) => (
                  <button
                    key={table}
                    onClick={() => activeDatabase && handleTableClick(activeDatabase, table)}
                    className="w-full flex items-center gap-2 px-2 py-1 text-sm hover:bg-accent rounded group"
                  >
                    <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />
                    <span className="truncate">{table}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeConnectionId) toggleFavorite(activeConnectionId, table);
                      }}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-auto"
                    >
                      <X className="w-3 h-3 text-muted-foreground hover:text-foreground" />
                    </button>
                  </button>
                ))}
                <Separator className="mt-1" />
              </div>
            )}

            {/* Recent tables section */}
            {recentTables.length > 0 && !searchQuery && (
              <div className="px-2 py-1">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider px-2 py-1">
                  Recent
                </div>
                {recentTables.slice(0, 5).map((table) => (
                  <button
                    key={table}
                    onClick={() => activeDatabase && handleTableClick(activeDatabase, table)}
                    className="w-full flex items-center gap-2 px-2 py-1 text-sm hover:bg-accent rounded"
                  >
                    <Clock className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{table}</span>
                  </button>
                ))}
                <Separator className="mt-1" />
              </div>
            )}

            {/* Single-database mode: flat table list */}
            {activeDatabase && !searchQuery ? (
              activeTables.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  No tables in {activeDatabase}
                </p>
              ) : (
                activeTables.map((table) => {
                  const key = `${activeDatabase}.${table.name}`;
                  return (
                    <TableNode
                      key={table.name}
                      table={table}
                      dbName={activeDatabase}
                      expanded={expandedTables.has(key)}
                      loading={structureLoading[key] ?? false}
                      columns={structures[key]?.columns}
                      onToggle={() => toggleTable(activeDatabase, table.name)}
                      onClick={() => handleTableClick(activeDatabase, table.name)}
                      onColumnClick={handleColumnClick}
                      selectedColumn={selectedColumn}
                      searchQuery=""
                      onTruncate={() => handleTruncateTable(activeDatabase, table.name)}
                      onDrop={() => handleDropTable(activeDatabase, table.name)}
                      onRename={() => handleRenameTable(activeDatabase, table.name)}
                      flat
                      isFavorited={activeConnectionId ? isFavorite(activeConnectionId, table.name) : false}
                      onToggleFavorite={activeConnectionId ? () => toggleFavorite(activeConnectionId, table.name) : undefined}
                    />
                  );
                })
              )
            ) : visibleDatabases.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No databases found
              </p>
            ) : (
              <SearchableTree
                databases={visibleDatabases}
                tables={tables}
                structures={structures}
                structureLoading={structureLoading}
                searchQuery={searchQuery}
                expandedDbs={expandedDbs}
                expandedTables={expandedTables}
                selectedColumn={selectedColumn}
                onToggleDb={toggleDb}
                onToggleTable={toggleTable}
                onTableClick={handleTableClick}
                onColumnClick={handleColumnClick}
                onTruncateTable={handleTruncateTable}
                onDropTable={handleDropTable}
                onRenameTable={handleRenameTable}
                isFavorite={activeConnectionId ? (table: string) => isFavorite(activeConnectionId, table) : undefined}
                onToggleFavorite={activeConnectionId ? (table: string) => toggleFavorite(activeConnectionId, table) : undefined}
              />
            )}
          </div>
        </ScrollArea>

        {/* Column properties panel */}
        {selectedColumn && (
          <ColumnProperties column={selectedColumn} onClose={() => setSelectedColumn(null)} />
        )}
      </div>
    </TooltipProvider>
  );
});

// ─── Column properties panel ──────────────────────────────────────────────────

function ColumnProperties({ column, onClose }: { column: ColumnInfo; onClose: () => void }) {
  return (
    <div className="border-t border-sidebar-border">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Properties
        </span>
        <button
          onClick={onClose}
          className="rounded-sm p-0.5 hover:bg-sidebar-accent"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      <Separator />
      <div className="space-y-1.5 px-3 py-2 text-[11px]">
        <PropertyRow label="Name" value={column.name} highlight />
        <PropertyRow label="Type" value={formatDataType(column.data_type)} />
        <PropertyRow label="Mapped" value={formatDataType(column.mapped_type)} />
        <PropertyRow label="Nullable" value={column.nullable ? 'Yes' : 'No'} />
        <PropertyRow label="Primary Key" value={column.is_primary_key ? 'Yes' : 'No'} />
        <PropertyRow label="Position" value={String(column.ordinal_position)} />
        {column.default_value != null && (
          <PropertyRow label="Default" value={column.default_value} />
        )}
        {column.comment && (
          <PropertyRow label="Comment" value={column.comment} />
        )}
      </div>
    </div>
  );
}

function PropertyRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'truncate text-right',
          highlight ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Highlight match ─────────────────────────────────────────────────────────

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="bg-primary/25 text-primary rounded-sm">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

// ─── Searchable tree ─────────────────────────────────────────────────────────

interface SearchableTreeProps {
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
}

function SearchableTree({
  databases, tables, structures, structureLoading,
  searchQuery, expandedDbs, expandedTables, selectedColumn,
  onToggleDb, onToggleTable, onTableClick, onColumnClick,
  onTruncateTable, onDropTable, onRenameTable,
  isFavorite, onToggleFavorite,
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
        />
      ))}
    </>
  );
}

// ─── Database node ────────────────────────────────────────────────────────────

interface DatabaseNodeProps {
  name: string;
  sizeBytes: number | null;
  expanded: boolean;
  onToggle: () => void;
  tables: TableInfo[];
  expandedTables: Set<string>;
  structures: Record<string, { columns: ColumnInfo[] }>;
  structureLoading: Record<string, boolean>;
  dbName: string;
  onToggleTable: (db: string, table: string) => void;
  onTableClick: (db: string, table: string) => void;
  onColumnClick: (column: ColumnInfo) => void;
  selectedColumn: ColumnInfo | null;
  searchQuery: string;
  tableColumnMatches: Set<string>;
  onTruncateTable: (db: string, table: string) => void;
  onDropTable: (db: string, table: string) => void;
  onRenameTable: (db: string, table: string) => void;
  isFavorite?: (table: string) => boolean;
  onToggleFavorite?: (table: string) => void;
}

function DatabaseNode({
  name,
  sizeBytes,
  expanded,
  onToggle,
  tables,
  expandedTables,
  structures,
  structureLoading,
  dbName,
  onToggleTable,
  onTableClick,
  onColumnClick,
  selectedColumn,
  searchQuery,
  tableColumnMatches,
  onTruncateTable,
  onDropTable,
  onRenameTable,
  isFavorite,
  onToggleFavorite,
}: DatabaseNodeProps) {
  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="group flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm hover:bg-sidebar-accent">
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
          <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium text-sidebar-foreground">
            <HighlightMatch text={name} query={searchQuery} />
          </span>
          {sizeBytes != null && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {formatBytes(sizeBytes)}
            </span>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {tables.length === 0 ? (
          <p className="py-1 pl-9 text-[11px] text-muted-foreground">No tables</p>
        ) : (
          tables.map((table) => {
            const key = `${dbName}.${table.name}`;
            const hasColumnMatch = tableColumnMatches.has(key);
            return (
              <TableNode
                key={table.name}
                table={table}
                dbName={dbName}
                expanded={expandedTables.has(key) || (!!searchQuery && hasColumnMatch)}
                loading={structureLoading[key] ?? false}
                columns={structures[key]?.columns}
                onToggle={() => onToggleTable(dbName, table.name)}
                onClick={() => onTableClick(dbName, table.name)}
                onColumnClick={onColumnClick}
                selectedColumn={selectedColumn}
                searchQuery={searchQuery}
                onTruncate={() => onTruncateTable(dbName, table.name)}
                onDrop={() => onDropTable(dbName, table.name)}
                onRename={() => onRenameTable(dbName, table.name)}
                isFavorited={isFavorite?.(table.name)}
                onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(table.name) : undefined}
              />
            );
          })
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Table node ───────────────────────────────────────────────────────────────

interface TableNodeProps {
  table: TableInfo;
  dbName: string;
  expanded: boolean;
  loading: boolean;
  columns: ColumnInfo[] | undefined;
  onToggle: () => void;
  onClick: () => void;
  onColumnClick: (column: ColumnInfo) => void;
  selectedColumn: ColumnInfo | null;
  searchQuery: string;
  onTruncate: () => void;
  onDrop: () => void;
  onRename: () => void;
  /** Render without database-level indentation (flat mode) */
  flat?: boolean;
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
}

function TableNode({
  table,
  expanded,
  loading,
  columns,
  onToggle,
  onClick,
  onColumnClick,
  selectedColumn,
  onTruncate,
  onDrop,
  onRename,
  searchQuery,
  flat,
  isFavorited,
  onToggleFavorite,
}: TableNodeProps) {
  const isView = table.table_type === 'View';
  const TableIcon = isView ? Eye : Table2;

  return (
    <Collapsible open={expanded}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn("group flex items-center", flat ? "pl-2" : "pl-5")}>
            {/* Expand/collapse chevron */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-sidebar-accent"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <ChevronRight
                  className={cn(
                    'h-3 w-3 text-muted-foreground transition-transform duration-200',
                    expanded && 'rotate-90',
                  )}
                />
              )}
            </button>

            {/* Table name — click to query */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onClick}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-sidebar-accent"
                >
                  <TableIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isView ? 'text-accent-foreground' : 'text-muted-foreground',
                    )}
                  />
                  <span className="truncate text-sidebar-foreground">
                    <HighlightMatch text={table.name} query={searchQuery} />
                  </span>
                  {table.row_count_estimate != null && (
                    <Badge variant="secondary" className="ml-auto h-4 px-1 text-[9px]">
                      ~{table.row_count_estimate.toLocaleString()}
                    </Badge>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                <p className="font-medium">{table.name}</p>
                <p className="text-muted-foreground">
                  {isView ? 'View' : 'Table'}
                  {table.row_count_estimate != null && ` · ~${table.row_count_estimate.toLocaleString()} rows`}
                  {table.size_bytes != null && ` · ${formatBytes(table.size_bytes)}`}
                </p>
                {table.comment && <p className="mt-1 text-muted-foreground">{table.comment}</p>}
              </TooltipContent>
            </Tooltip>

            {onToggleFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                className={cn(
                  'flex-shrink-0 p-0.5 rounded-sm transition-opacity',
                  isFavorited ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <Star className={cn(
                  'w-3 h-3',
                  isFavorited
                    ? 'text-yellow-500 fill-yellow-500'
                    : 'text-muted-foreground hover:text-yellow-500',
                )} />
              </button>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={onClick}>
            <Table2 className="mr-2 h-3.5 w-3.5" /> Open Table
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(table.name);
          }}>
            <Copy className="mr-2 h-3.5 w-3.5" /> Copy Name
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(`SELECT * FROM \`${table.name}\` LIMIT 500`);
          }}>
            <Terminal className="mr-2 h-3.5 w-3.5" /> Copy SELECT Query
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(`SELECT COUNT(*) FROM \`${table.name}\``);
          }}>
            <Hash className="mr-2 h-3.5 w-3.5" /> Copy COUNT Query
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(`DESCRIBE \`${table.name}\``);
          }}>
            <Info className="mr-2 h-3.5 w-3.5" /> Copy DESCRIBE Query
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Rename Table
          </ContextMenuItem>
          <ContextMenuItem onClick={onTruncate}>
            <Eraser className="mr-2 h-3.5 w-3.5" /> Truncate Table
          </ContextMenuItem>
          <ContextMenuItem onClick={onDrop} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Drop Table
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CollapsibleContent>
        {columns && columns.length > 0 && (
          <div className={cn("border-l border-sidebar-border", flat ? "ml-7" : "ml-10")}>
            {columns.map((col) => {
              // When searching by column name, only show matching columns
              if (searchQuery && !table.name.toLowerCase().includes(searchQuery) && !col.name.toLowerCase().includes(searchQuery)) {
                return null;
              }
              return (
                <ColumnNode
                  key={col.name}
                  column={col}
                  selected={
                    selectedColumn?.name === col.name &&
                    selectedColumn?.ordinal_position === col.ordinal_position
                  }
                  onClick={() => onColumnClick(col)}
                  searchQuery={searchQuery}
                />
              );
            })}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Column node ──────────────────────────────────────────────────────────────

interface ColumnNodeProps {
  column: ColumnInfo;
  selected: boolean;
  onClick: () => void;
  searchQuery?: string;
}

function ColumnNode({ column, selected, onClick, searchQuery = '' }: ColumnNodeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] hover:bg-sidebar-accent',
            selected && 'bg-sidebar-accent',
          )}
        >
          {column.is_primary_key ? (
            <Key className="h-3 w-3 shrink-0 text-primary" />
          ) : (
            <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              'truncate',
              column.is_primary_key
                ? 'font-medium text-sidebar-foreground'
                : 'text-muted-foreground',
            )}
          >
            <HighlightMatch text={column.name} query={searchQuery} />
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {formatDataType(column.data_type)}
          </span>
          {column.nullable && (
            <span className="text-[9px] text-muted-foreground/60">?</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <p>
          <span className="font-medium">{column.name}</span>{' '}
          <span className="text-muted-foreground">{formatDataType(column.data_type)}</span>
        </p>
        <p className="text-muted-foreground">
          {column.nullable ? 'Nullable' : 'Not null'}
          {column.is_primary_key && ' · Primary key'}
          {column.default_value != null && ` · Default: ${column.default_value}`}
        </p>
        {column.comment && <p className="mt-1 text-muted-foreground">{column.comment}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
