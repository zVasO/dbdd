import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useShallow } from 'zustand/shallow';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useUIStore } from '@/stores/uiStore';
import { useActivityStore } from '@/stores/activityStore';
import { Separator } from '@/components/ui/separator';
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
  ChevronDown,
  Clock,
  Copy,
  Database,
  Check,
  Eraser,
  Hash,
  Info,
  Layers,
  Pencil,
  Plus,
  Search,
  Star,
  Table2,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { ipc, extractErrorMessage } from '@/lib/ipc';
import { showErrorToast } from '@/stores/toastStore';
import { quoteIdentifier } from '@/lib/sql-utils';
import { cn } from '@/lib/utils';
import { getFuzzySearchBridge, type ScoredItem } from '@/lib/fuzzy-search-bridge';
import { useFavoritesStore } from '@/stores/favoritesStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import type { ColumnInfo } from '@/lib/types';

import { formatBytes } from './sidebar/utils';
import { ColumnProperties } from './sidebar/ColumnProperties';
import { FuzzySearchResults } from './sidebar/FuzzySearchResults';
import { SearchableTree } from './sidebar/SchemaTree';
import { ConfirmDestructiveDialog } from './sidebar/ConfirmDestructiveDialog';
import { flattenSidebarTree, type FlatNode } from './sidebar/sidebarTree';
import { SidebarRow, ROW_HEIGHT, type SidebarRowHandlers } from './sidebar/SidebarRow';
import type { TableStructure } from '@/lib/types';
import type { VirtualItem } from '@tanstack/react-virtual';

const EMPTY_NODES: FlatNode[] = [];
const EMPTY_STRUCTURES: Record<string, TableStructure> = {};

interface SidebarVirtualRowsProps {
  virtualItems: VirtualItem[];
  flatNodes: FlatNode[];
  selectedColumn: ColumnInfo | null;
  favoriteSet: Set<string>;
  handlers: Omit<SidebarRowHandlers, 'onRowMouseEnter'>;
}

const TOOLTIP_OPEN_DELAY_MS = 300;

// Owns hoveredKey (+ the tooltip's open timer) so a hover change only
// re-renders this subtree, not the whole Sidebar (which also holds search,
// favorites, and the db selector).
const SidebarVirtualRows = React.memo(function SidebarVirtualRows({
  virtualItems, flatNodes, selectedColumn, favoriteSet, handlers,
}: SidebarVirtualRowsProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Radix's TooltipTrigger only starts its own open sequence from a real
  // onPointerMove — since we swap a row between a bare button and a
  // Tooltip-wrapped one on `isHovered`, the trigger is freshly mounted under
  // an already-stationary pointer and never receives that event, so a
  // hover-and-hold would never open it. Drive `open` ourselves instead.
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const clearOpenTimer = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  }, []);

  const closeTooltip = useCallback(() => {
    clearOpenTimer();
    setHoveredKey(null);
    setTooltipOpen(false);
  }, [clearOpenTimer]);

  const handleRowMouseEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const key = (e.currentTarget as HTMLElement).dataset.key;
    if (!key) return;
    setHoveredKey(key);
    // Restart the delay on every row change so adjacent-row hovering never
    // flashes the previous row's (already-open) tooltip onto the new one.
    setTooltipOpen(false);
    clearOpenTimer();
    openTimerRef.current = setTimeout(() => setTooltipOpen(true), TOOLTIP_OPEN_DELAY_MS);
  }, [clearOpenTimer]);

  // Scrolling moves rows out from under a stationary pointer without firing
  // mouse events, which would otherwise leave a stale tooltip tracking (via
  // Radix's own Popper reposition) a row the cursor is no longer over.
  useEffect(() => {
    const scrollEl = wrapperRef.current?.closest<HTMLElement>('[data-tree-scroll]');
    if (!scrollEl) return;
    scrollEl.addEventListener('scroll', closeTooltip, { passive: true });
    return () => scrollEl.removeEventListener('scroll', closeTooltip);
  }, [closeTooltip]);

  useEffect(() => () => clearOpenTimer(), [clearOpenTimer]);

  const rowHandlers = useMemo<SidebarRowHandlers>(
    () => ({ ...handlers, onRowMouseEnter: handleRowMouseEnter }),
    [handlers, handleRowMouseEnter],
  );

  return (
    <div ref={wrapperRef} onMouseLeave={closeTooltip}>
      {virtualItems.map((item) => {
        const node = flatNodes[item.index];
        const isHovered = node.key === hoveredKey;
        return (
          <div
            key={node.key}
            className="absolute left-0 top-0 w-full"
            style={{ height: item.size, transform: `translateY(${item.start}px)` }}
          >
            <SidebarRow
              node={node}
              isActive={
                node.kind === 'column' &&
                selectedColumn?.name === node.name &&
                selectedColumn?.ordinal_position === node.ordinalPosition
              }
              isFavorite={node.kind === 'table' && favoriteSet.has(node.table)}
              isHovered={isHovered}
              isTooltipOpen={isHovered && tooltipOpen}
              handlers={rowHandlers}
            />
          </div>
        );
      })}
    </div>
  );
});

interface SidebarProps {
  onOpenConnectionDialog?: () => void;
}

export const Sidebar = React.memo(function Sidebar({ onOpenConnectionDialog }: SidebarProps = {}) {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const databases = useSchemaStore((s) => s.databases);
  const tables = useSchemaStore((s) => s.tables);
  const activeDatabase = useSchemaStore((s) => s.activeDatabase);
  const { loadTables, loadTableStructure, setActiveDatabase } = useSchemaStore.getState();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const dbType = activeConfig?.db_type ?? 'mysql';
  const { createTab, updateSql, executeQuery, setActiveTab, setHighlightedColumn } = useQueryStore.getState();

  const favoritesMap = useFavoritesStore((s) => s.favorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
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
  const [destructiveDialog, setDestructiveDialog] = useState<{
    open: boolean;
    operation: 'drop' | 'truncate' | 'rename';
    db: string;
    tableName: string;
  } | null>(null);
  const [contextTable, setContextTable] = useState<{ db: string; table: string } | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dbSelectorRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);

  // The flatten only needs the EXPANDED tables' structures — subscribing to
  // the whole `structures`/`structureLoading` records would re-render the
  // sidebar on every structure load, even for collapsed tables.
  const expandedKeys = useMemo(() => [...expandedTables], [expandedTables]);
  const expandedStructuresList = useSchemaStore(
    useShallow((s) => expandedKeys.map((k) => s.structures[k])),
  );
  const expandedLoadingList = useSchemaStore(
    useShallow((s) => expandedKeys.map((k) => !!s.structureLoading[k])),
  );
  const structures = useMemo(() => {
    const rec: Record<string, TableStructure | undefined> = {};
    expandedKeys.forEach((key, i) => { rec[key] = expandedStructuresList[i]; });
    return rec;
  }, [expandedKeys, expandedStructuresList]);
  const structureLoading = useMemo(() => {
    const rec: Record<string, boolean | undefined> = {};
    expandedKeys.forEach((key, i) => { rec[key] = expandedLoadingList[i]; });
    return rec;
  }, [expandedKeys, expandedLoadingList]);

  // SearchableTree matches columns across every cached table, not just the
  // expanded ones, so it needs the full record — but only while a search is
  // actually active; otherwise this stays a stable empty object so structure
  // loads elsewhere don't re-render the sidebar.
  const searchStructures = useSchemaStore((s) => (searchQuery ? s.structures : EMPTY_STRUCTURES));

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
    }, 250);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

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

  const handleTableClick = useCallback((db: string, tableName: string) => {
    if (!activeConnectionId) return;
    trackTableOpen(activeConnectionId, tableName);
    // Reuse existing tab for same table + database, re-query if limit changed
    const existing = useQueryStore.getState().tabs.find((t) => t.table === tableName && t.database === db);
    if (existing) {
      setActiveTab(existing.id);
      const pageSize = usePreferencesStore.getState().defaultPageSize;
      // MySQL supports cross-database `db`.`table` syntax; PostgreSQL/SQLite use just the table name
      // (tables are resolved via search_path / the public schema of the connected database)
      const tableRef = dbType === 'mysql'
        ? `${quoteIdentifier(db, dbType)}.${quoteIdentifier(tableName, dbType)}`
        : quoteIdentifier(tableName, dbType);
      const expectedSql = pageSize > 0
        ? `SELECT * FROM ${tableRef} LIMIT ${pageSize}`
        : `SELECT * FROM ${tableRef}`;
      if (existing.sql !== expectedSql) {
        updateSql(existing.id, expectedSql);
        executeQuery(activeConnectionId, existing.id);
      }
      return;
    }
    const pageSize = usePreferencesStore.getState().defaultPageSize;
    const tableRef = dbType === 'mysql'
      ? `${quoteIdentifier(db, dbType)}.${quoteIdentifier(tableName, dbType)}`
      : quoteIdentifier(tableName, dbType);
    const sql = pageSize > 0
      ? `SELECT * FROM ${tableRef} LIMIT ${pageSize}`
      : `SELECT * FROM ${tableRef}`;
    const tabId = createTab(tableName, { editorVisible: false, database: db, table: tableName });
    updateSql(tabId, sql);
    executeQuery(activeConnectionId, tabId);
  }, [activeConnectionId, dbType, trackTableOpen, setActiveTab, updateSql, executeQuery, createTab]);

  const handleColumnClick = useCallback((column: ColumnInfo) => {
    setSelectedColumn((prev) =>
      prev?.name === column.name && prev?.ordinal_position === column.ordinal_position
        ? null
        : column,
    );
  }, []);

  // Double-click on a column: open its parent table and highlight that column in the grid
  const handleColumnDoubleClick = useCallback((db: string, tableName: string, colName: string) => {
    handleTableClick(db, tableName);
    const tabId = useQueryStore.getState().activeTabId;
    if (tabId) setHighlightedColumn(tabId, colName);
  }, [handleTableClick, setHighlightedColumn]);

  const handleTruncateTable = (db: string, tableName: string) => {
    setDestructiveDialog({ open: true, operation: 'truncate', db, tableName });
  };

  const handleDropTable = (db: string, tableName: string) => {
    setDestructiveDialog({ open: true, operation: 'drop', db, tableName });
  };

  const handleRenameTable = (db: string, tableName: string) => {
    setDestructiveDialog({ open: true, operation: 'rename', db, tableName });
  };

  // Everything the row handlers below read at call time. They must never take a
  // dependency on these values directly: their identities feed the one
  // `handlers` object each SidebarRow memo compares against.
  const rowState = {
    activeConnectionId, expandedDbs, expandedTables, tables, structures,
    handleTableClick, handleColumnClick, handleColumnDoubleClick, toggleFavorite,
  };
  const rowStateRef = useRef(rowState);
  useLayoutEffect(() => {
    rowStateRef.current = rowState;
  });

  const toggleDb = useCallback((dbName: string) => {
    const { activeConnectionId, expandedDbs, tables } = rowStateRef.current;
    const next = new Set(expandedDbs);
    if (next.has(dbName)) {
      next.delete(dbName);
    } else {
      next.add(dbName);
      if (activeConnectionId && !tables[dbName]) {
        loadTables(activeConnectionId, dbName);
      }
    }
    setExpandedDbs(next);
  }, [loadTables]);

  const toggleTable = useCallback((dbName: string, tableName: string) => {
    const { activeConnectionId, expandedTables } = rowStateRef.current;
    const key = `${dbName}.${tableName}`;
    const next = new Set(expandedTables);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      // Read the full store here, not the expanded-only slice above: this key
      // isn't in `expandedTables` yet on a re-expand, so the slice wouldn't
      // see a structure that's still cached from before it was collapsed.
      if (activeConnectionId && !useSchemaStore.getState().structures[key]) {
        loadTableStructure(activeConnectionId, {
          database: dbName,
          schema: null,
          table: tableName,
        });
      }
    }
    setExpandedTables(next);
  }, [loadTableStructure]);

  const handleRowClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { kind, db, table, colname, ordinal } = (e.currentTarget as HTMLElement).dataset;
    const s = rowStateRef.current;
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'fav') {
      if (s.activeConnectionId && table) s.toggleFavorite(s.activeConnectionId, table);
      return;
    }
    if (kind === 'db') {
      if (db) toggleDb(db);
      return;
    }
    if (kind === 'table') {
      if (db && table) s.handleTableClick(db, table);
      return;
    }
    if (db && table && colname) {
      const column = s.structures[`${db}.${table}`]?.columns.find(
        (c) => c.name === colname && String(c.ordinal_position) === ordinal,
      );
      if (column) s.handleColumnClick(column);
    }
  }, [toggleDb]);

  const handleRowDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { kind, db, table, colname } = (e.currentTarget as HTMLElement).dataset;
    if (kind !== 'column' || !db || !table || !colname) return;
    rowStateRef.current.handleColumnDoubleClick(db, table, colname);
  }, []);

  const handleRowContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { kind, db, table } = (e.currentTarget as HTMLElement).dataset;
    if (kind !== 'table' || !db || !table) return;
    setContextTable({ db, table });
  }, []);

  // Right-clicks that miss a table row must not reach the shared menu's trigger.
  const handleTreeContextMenuCapture = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!(e.target as HTMLElement).closest('[data-kind="table"]')) e.stopPropagation();
  }, []);

  const handleCaretClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-kind]');
    const { kind, db, table } = row?.dataset ?? {};
    if (kind === 'table' && db && table) toggleTable(db, table);
  }, [toggleTable]);

  const rowHandlers = useMemo<Omit<SidebarRowHandlers, 'onRowMouseEnter'>>(() => ({
    onRowClick: handleRowClick,
    onRowDoubleClick: handleRowDoubleClick,
    onRowContextMenu: handleRowContextMenu,
    onCaretClick: handleCaretClick,
  }), [handleRowClick, handleRowDoubleClick, handleRowContextMenu, handleCaretClick]);

  const flatNodes = useMemo(() => {
    if (searchQuery) return EMPTY_NODES;
    if (activeDatabase) {
      return flattenSidebarTree({
        mode: 'flat',
        databases: [activeDatabase],
        tablesByDb: tables,
        expandedDbs, expandedTables, structures, structureLoading,
      });
    }
    const dbSizes: Record<string, number | null> = {};
    for (const db of databases) dbSizes[db.name] = db.size_bytes;
    return flattenSidebarTree({
      mode: 'nested',
      databases: databases.map((db) => db.name),
      tablesByDb: tables,
      expandedDbs, expandedTables, structures, structureLoading, dbSizes,
    });
  }, [searchQuery, activeDatabase, databases, tables, expandedDbs, expandedTables, structures, structureLoading]);

  const rowVirtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: (index) => ROW_HEIGHT[flatNodes[index].kind],
    overscan: 8,
  });

  // Row heights come from the node kinds, never from the DOM, so a reshaped
  // tree of the same length has to invalidate the size cache by hand. Runs
  // before paint so the virtualizer never flashes stale offsets.
  useLayoutEffect(() => {
    rowVirtualizer.measure();
  }, [flatNodes, rowVirtualizer]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);

  const handleDestructiveConfirm = async (newName?: string) => {
    if (!destructiveDialog || !activeConnectionId) return;
    const { operation, db, tableName } = destructiveDialog;
    const tbl = dbType === 'mysql'
      ? `${quoteIdentifier(db, dbType)}.${quoteIdentifier(tableName, dbType)}`
      : quoteIdentifier(tableName, dbType);
    try {
      if (operation === 'truncate') {
        await ipc.executeQuery(activeConnectionId, `TRUNCATE TABLE ${tbl}`);
      } else if (operation === 'drop') {
        await ipc.executeQuery(activeConnectionId, `DROP TABLE ${tbl}`);
      } else if (operation === 'rename' && newName) {
        const newTbl = dbType === 'mysql'
          ? `${quoteIdentifier(db, dbType)}.${quoteIdentifier(newName, dbType)}`
          : quoteIdentifier(newName, dbType);
        await ipc.executeQuery(activeConnectionId, `ALTER TABLE ${tbl} RENAME TO ${newTbl}`);
      }
      loadTables(activeConnectionId, db);
    } catch (err) {
      showErrorToast(`${operation} failed: ${extractErrorMessage(err)}`);
    }
  };

  // Determine the active DB info for display
  const activeDbInfo = databases.find((db) => db.name === activeDatabase);
  const activeTables = activeDatabase ? (tables[activeDatabase] ?? []) : [];

  if (!sidebarOpen) return null;

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className="flex shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar/80 backdrop-blur-sm text-sidebar-foreground"
        style={{ width: 'var(--sidebar-width)' }}
      >
        {/* Database selector — pl-[78px] reserves space for macOS traffic lights.
            The row is a window drag region; interactive controls opt out with no-drag. */}
        <div className="relative border-b border-sidebar-border h-9" ref={dbSelectorRef}>
          <div
            className="flex h-full items-center pl-[78px]"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
          <button
            onClick={() => setDbSelectorOpen(!dbSelectorOpen)}
            className="flex flex-1 min-w-0 h-full items-center gap-2 px-3 text-left hover:bg-sidebar-accent/50 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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
                  style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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
              className="flex-1 bg-transparent text-xs text-sidebar-foreground placeholder:text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset rounded"
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

        {/* Favorites and recent tables — pinned above the virtualized tree */}
        {(favorites.length > 0 || recentTables.length > 0) && !searchQuery && (
          <div className="max-h-[35%] shrink-0 overflow-y-auto py-1">
            {favorites.length > 0 && (
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

            {recentTables.length > 0 && (
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
          </div>
        )}

        <div
          ref={treeScrollRef}
          data-tree-scroll
          onContextMenuCapture={handleTreeContextMenuCapture}
          className="flex-1 overflow-y-auto py-1"
        >
          {/* One context menu for the whole tree — opened by the right-clicked row */}
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div>
                {searchQuery && fuzzyResults ? (
                  <FuzzySearchResults
                    results={fuzzyResults}
                    searchQuery={searchQuery}
                    onTableClick={handleTableClick}
                    onColumnClick={handleColumnClick}
                    onColumnDoubleClick={handleColumnDoubleClick}
                    selectedColumn={selectedColumn}
                  />
                ) : searchQuery ? (
                  /* Fallback while fuzzy results load — show existing search */
                  <SearchableTree
                    databases={visibleDatabases}
                    tables={tables}
                    structures={searchStructures}
                    searchQuery={searchQuery}
                    selectedColumn={selectedColumn}
                    onTableClick={handleTableClick}
                    onColumnClick={handleColumnClick}
                    onColumnDoubleClick={handleColumnDoubleClick}
                  />
                ) : flatNodes.length === 0 ? (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                    {activeDatabase ? `No tables in ${activeDatabase}` : 'No databases found'}
                  </p>
                ) : (
                  <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
                    <SidebarVirtualRows
                      virtualItems={rowVirtualizer.getVirtualItems()}
                      flatNodes={flatNodes}
                      selectedColumn={selectedColumn}
                      favoriteSet={favoriteSet}
                      handlers={rowHandlers}
                    />
                  </div>
                )}
              </div>
            </ContextMenuTrigger>
            {contextTable && (
              <ContextMenuContent className="w-48">
                <ContextMenuItem onClick={() => handleTableClick(contextTable.db, contextTable.table)}>
                  <Table2 className="mr-2 h-3.5 w-3.5" /> Open Table
                </ContextMenuItem>
                <ContextMenuItem onClick={() => navigator.clipboard.writeText(contextTable.table)}>
                  <Copy className="mr-2 h-3.5 w-3.5" /> Copy Name
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => {
                  const pageSize = usePreferencesStore.getState().defaultPageSize;
                  navigator.clipboard.writeText(pageSize > 0
                    ? `SELECT * FROM \`${contextTable.table}\` LIMIT ${pageSize}`
                    : `SELECT * FROM \`${contextTable.table}\``);
                }}>
                  <Terminal className="mr-2 h-3.5 w-3.5" /> Copy SELECT Query
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  navigator.clipboard.writeText(`SELECT COUNT(*) FROM \`${contextTable.table}\``);
                }}>
                  <Hash className="mr-2 h-3.5 w-3.5" /> Copy COUNT Query
                </ContextMenuItem>
                <ContextMenuItem onClick={() => {
                  navigator.clipboard.writeText(`DESCRIBE \`${contextTable.table}\``);
                }}>
                  <Info className="mr-2 h-3.5 w-3.5" /> Copy DESCRIBE Query
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => handleRenameTable(contextTable.db, contextTable.table)}>
                  <Pencil className="mr-2 h-3.5 w-3.5" /> Rename Table
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleTruncateTable(contextTable.db, contextTable.table)}>
                  <Eraser className="mr-2 h-3.5 w-3.5" /> Truncate Table
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => handleDropTable(contextTable.db, contextTable.table)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" /> Drop Table
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
        </div>

        {/* Column properties panel */}
        {selectedColumn && (
          <ColumnProperties column={selectedColumn} onClose={() => setSelectedColumn(null)} />
        )}
      </div>

      {destructiveDialog && (
        <ConfirmDestructiveDialog
          key={`${destructiveDialog.tableName}-${destructiveDialog.operation}`}
          open={destructiveDialog.open}
          onOpenChange={(open) => setDestructiveDialog((prev) => prev ? { ...prev, open } : null)}
          operation={destructiveDialog.operation}
          tableName={destructiveDialog.tableName}
          onConfirm={handleDestructiveConfirm}
        />
      )}
    </TooltipProvider>
  );
});
