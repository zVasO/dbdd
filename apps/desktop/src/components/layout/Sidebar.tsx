import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useUIStore } from '@/stores/uiStore';
import { useActivityStore } from '@/stores/activityStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  ChevronDown,
  Clock,
  Database,
  Check,
  Layers,
  Plus,
  Search,
  Star,
  X,
} from 'lucide-react';
import { ipc } from '@/lib/ipc';
import { cn } from '@/lib/utils';
import { getFuzzySearchBridge, type ScoredItem } from '@/lib/fuzzy-search-bridge';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import type { ColumnInfo } from '@/lib/types';

import { formatBytes } from './sidebar/utils';
import { ColumnProperties } from './sidebar/ColumnNode';
import { FuzzySearchResults } from './sidebar/FuzzySearchResults';
import { SearchableTree } from './sidebar/SchemaTree';
import { TableNode } from './sidebar/TableNode';

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
  const { createTab, updateSql, executeQuery, setActiveTab } = useQueryStore.getState();

  const favoritesMap = useFavoritesStore((s) => s.favorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const isFavorite = useFavoritesStore((s) => s.isFavorite);
  const favorites = useMemo(
    () => (activeConnectionId ? favoritesMap[activeConnectionId] ?? [] : []),
    [favoritesMap, activeConnectionId],
  );

  const recentTablesRaw = useActivityStore((s) => s.recentTables);
  const trackTableOpen = useActivityStore((s) => s.trackTableOpen);
  const recentTables = useMemo(
    () => activeConnectionId
      ? recentTablesRaw.filter((r) => r.connectionId === activeConnectionId).map((r) => r.table)
      : [],
    [recentTablesRaw, activeConnectionId],
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [selectedColumn, setSelectedColumn] = useState<ColumnInfo | null>(null);
  const [dbSelectorOpen, setDbSelectorOpen] = useState(false);
  const [fuzzyResults, setFuzzyResults] = useState<ScoredItem[] | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Debounced fuzzy search when searchQuery changes
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (!searchQuery.trim()) {
      setFuzzyResults(null);
      return;
    }

    searchDebounceRef.current = setTimeout(async () => {
      const bridge = getFuzzySearchBridge();
      const results = await bridge.search(searchQuery, 'sidebar', { limit: 100 });
      setFuzzyResults(results);
    }, 80);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

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
    // Reuse existing tab for same table + database, re-query if limit changed
    const existing = useQueryStore.getState().tabs.find((t) => t.table === tableName && t.database === db);
    if (existing) {
      setActiveTab(existing.id);
      const pageSize = usePreferencesStore.getState().defaultPageSize;
      const expectedSql = pageSize > 0
        ? `SELECT * FROM \`${db}\`.\`${tableName}\` LIMIT ${pageSize}`
        : `SELECT * FROM \`${db}\`.\`${tableName}\``;
      if (existing.sql !== expectedSql) {
        updateSql(existing.id, expectedSql);
        executeQuery(activeConnectionId, existing.id);
      }
      return;
    }
    const pageSize = usePreferencesStore.getState().defaultPageSize;
    const sql = pageSize > 0
      ? `SELECT * FROM \`${db}\`.\`${tableName}\` LIMIT ${pageSize}`
      : `SELECT * FROM \`${db}\`.\`${tableName}\``;
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
      await ipc.executeQuery(activeConnectionId, `TRUNCATE TABLE \`${db}\`.\`${tableName}\``);
      loadTables(activeConnectionId, db);
    } catch (err) {
      alert(`Failed to truncate: ${err}`);
    }
  };

  const handleDropTable = async (db: string, tableName: string) => {
    if (!activeConnectionId) return;
    if (!window.confirm(`DROP TABLE "${tableName}"? This action cannot be undone!`)) return;
    try {
      await ipc.executeQuery(activeConnectionId, `DROP TABLE \`${db}\`.\`${tableName}\``);
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
      await ipc.executeQuery(activeConnectionId, `ALTER TABLE \`${db}\`.\`${tableName}\` RENAME TO \`${db}\`.\`${newName}\``);
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

            {/* Fuzzy search results */}
            {searchQuery && fuzzyResults ? (
              <FuzzySearchResults
                results={fuzzyResults}
                searchQuery={searchQuery}
                onTableClick={handleTableClick}
                onColumnClick={handleColumnClick}
                selectedColumn={selectedColumn}
              />
            ) : searchQuery ? (
              /* Fallback while fuzzy results load — show existing search */
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
              />
            ) : activeDatabase ? (
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
