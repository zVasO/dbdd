import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { useQueryStore } from '@/stores/queryStore';
import { useResultStore, type TabResult } from '@/stores/resultStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { EditorTabs } from '@/components/editor/EditorTabs';
import { SqlEditor } from '@/components/editor/SqlEditor';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { DataGrid, type SortRequest } from '@/components/grid/DataGrid';
import { TableStructureView } from '@/components/grid/TableStructureView';
import { FilterBar } from '@/components/grid/FilterBar';
import { ColumnFilter } from '@/components/grid/ColumnFilter';
import { CodePreview } from '@/components/editor/CodePreview';
import { WelcomeScreen } from '@/components/layout/WelcomeScreen';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { cn } from '@/lib/utils';
import { quoteIdentifier } from '@/lib/sql-utils';
import { ipc } from '@/lib/ipc';
import { Table2, Columns3 } from 'lucide-react';
import { useUIStore } from '@/stores/uiStore';
import { usePreferencesStore } from '@/stores/preferencesStore';
import type { QueryResult } from '@/lib/types';
import type { QueryTab, TabViewMode } from '@/stores/queryStore';

const ERDiagramView = lazy(() => import('@/components/er-diagram/ERDiagramView').then(m => ({ default: m.ERDiagramView })));
const DashboardView = lazy(() => import('@/components/dashboard/DashboardView').then(m => ({ default: m.DashboardView })));
const HealthDashboard = lazy(() => import('@/components/health/HealthDashboard').then(m => ({ default: m.HealthDashboard })));
const ExplainView = lazy(() => import('@/components/profiler/ExplainView').then(m => ({ default: m.ExplainView })));
const QueryBuilderView = lazy(() => import('@/components/query-builder/QueryBuilderView').then(m => ({ default: m.QueryBuilderView })));
const SchemaMigrationView = lazy(() => import('@/components/migration/SchemaMigrationView').then(m => ({ default: m.SchemaMigrationView })));
const AlertManager = lazy(() => import('@/components/alerts/AlertManager').then(m => ({ default: m.AlertManager })));
const TableDesigner = lazy(() => import('@/components/schema/TableDesigner').then(m => ({ default: m.TableDesigner })));
const ProcessList = lazy(() => import('@/components/admin/ProcessList').then(m => ({ default: m.ProcessList })));

const LazyFallback = () => <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">Loading...</div>;

const MIN_PANEL_PX = 100;

interface SplitEditorResultsProps {
  readonly children: [React.ReactNode, React.ReactNode];
}

function SplitEditorResults({ children }: SplitEditorResultsProps) {
  const storedRatio = usePreferencesStore((s) => s.editorSplitRatio);
  const [ratio, setRatio] = useState(storedRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const containerHeight = rect.height;
      if (containerHeight === 0) return;

      const offsetY = moveEvent.clientY - rect.top;
      const minRatio = (MIN_PANEL_PX / containerHeight) * 100;
      const maxRatio = 100 - minRatio;
      const newRatio = Math.min(maxRatio, Math.max(minRatio, (offsetY / containerHeight) * 100));
      setRatio(newRatio);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      // Persist final ratio
      setRatio((finalRatio) => {
        usePreferencesStore.getState().setPreference('editorSplitRatio', finalRatio);
        return finalRatio;
      });
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden">
      <div className="overflow-hidden" style={{ height: `${ratio}%`, minHeight: `${MIN_PANEL_PX}px` }}>
        {children[0]}
      </div>
      <div
        className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/30"
        onMouseDown={handleMouseDown}
      />
      <div className="flex flex-1 flex-col overflow-hidden border-t border-border">
        {children[1]}
      </div>
    </div>
  );
}

interface PanelLayoutProps {
  readonly paneId?: 'primary' | 'secondary';
  readonly onOpenConnectionDialog?: () => void;
}

export function PanelLayout({ paneId = 'primary', onOpenConnectionDialog }: PanelLayoutProps = {}) {
  const tabs = useQueryStore((s) => s.tabs);
  const primaryActiveTabId = useQueryStore((s) => s.activeTabId);
  const secondaryActiveTabId = useUIStore((s) => s.secondaryActiveTabId);
  const activeTabId = paneId === 'secondary' ? secondaryActiveTabId : primaryActiveTabId;
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const dbType = useConnectionStore((s) => {
    const connId = s.activeConnectionId;
    return connId ? s.activeConnections.find((c) => c.connectionId === connId)?.config.db_type ?? 'mysql' : 'mysql';
  });
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabResult = useResultStore((s) => activeTab ? s.results[activeTab.id] : undefined);

  const { updateSql, executeQuery, createTab, closeTab, setActiveTab: setPrimaryActiveTab, setEditorVisible, setViewMode, setActiveResult } = useQueryStore.getState();
  const setSecondaryActiveTab = useUIStore.getState().setSecondaryActiveTabId;
  const setActiveTab = paneId === 'secondary' ? setSecondaryActiveTab : setPrimaryActiveTab;

  const handleCreateQuery = () => {
    createTab();
  };

  // Read page size preference early — used by buildTableSql, handleFilterApply, and the re-query effect
  const defaultPageSize = usePreferencesStore((s) => s.defaultPageSize);

  const handleFilterApply = useCallback((whereClause: string) => {
    if (!activeConnectionId || !activeTab?.table || !activeTab?.database) return;
    const base = `SELECT * FROM ${quoteIdentifier(activeTab.table, dbType)}`;
    const limit = defaultPageSize > 0 ? ` LIMIT ${defaultPageSize}` : '';
    const sql = whereClause ? `${base} WHERE ${whereClause}${limit}` : `${base}${limit}`;
    updateSql(activeTab.id, sql);
    executeQuery(activeConnectionId, activeTab.id);
  }, [activeConnectionId, activeTab, defaultPageSize, dbType, updateSql, executeQuery]);

  const currentSql = activeTab?.sql ?? '';
  const buildTableSql = useCallback((tableName: string, sorts: SortRequest[]): string => {
    // Preserve existing WHERE clause from current SQL
    const whereMatch = currentSql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const whereClause = whereMatch ? ` WHERE ${whereMatch[1].trim()}` : '';

    const orderByClause = sorts.length > 0
      ? ` ORDER BY ${sorts.map((s) => `${quoteIdentifier(s.column, dbType)} ${s.direction.toUpperCase()}`).join(', ')}`
      : '';

    const limitClause = defaultPageSize > 0 ? ` LIMIT ${defaultPageSize}` : '';
    return `SELECT * FROM ${quoteIdentifier(tableName, dbType)}${whereClause}${orderByClause}${limitClause}`;
  }, [currentSql, defaultPageSize, dbType]);

  const handleServerSort = useCallback((sorts: SortRequest[]) => {
    if (!activeConnectionId || !activeTab?.table || !activeTab?.database) return;
    const sql = buildTableSql(activeTab.table, sorts);
    updateSql(activeTab.id, sql);
    executeQuery(activeConnectionId, activeTab.id);
  }, [activeConnectionId, activeTab, buildTableSql, updateSql, executeQuery]);

  // ─── Server-side pagination for table browse ─────────────────────────────
  const [serverPage, setServerPage] = useState(0);
  const [serverTotalRows, setServerTotalRows] = useState<number | undefined>(undefined);
  const prevTableRef = useRef<string | undefined>(undefined);

  // Fetch COUNT(*) once when a table is first opened
  useEffect(() => {
    if (!activeConnectionId || !activeTab?.table || !activeTab?.database) {
      setServerTotalRows(undefined);
      setServerPage(0);
      return;
    }
    // Only re-count when the table changes
    if (prevTableRef.current === activeTab.table) return;
    prevTableRef.current = activeTab.table;
    setServerPage(0);

    const qt = quoteIdentifier(activeTab.table, dbType);
    ipc.executeQueryColumnar(activeConnectionId, `SELECT COUNT(*) AS cnt FROM ${qt}`)
      .then((res) => {
        const count = res.data[0]?.values[0];
        setServerTotalRows(typeof count === 'number' ? count : 0);
      })
      .catch(() => setServerTotalRows(undefined));
  }, [activeConnectionId, activeTab?.table, activeTab?.database, dbType]);

  const handleServerPageChange = useCallback((page: number, pageSize: number) => {
    if (!activeConnectionId || !activeTab?.table || !activeTab?.database) return;
    setServerPage(page);

    const qt = quoteIdentifier(activeTab.table, dbType);
    // Preserve existing WHERE / ORDER BY from current SQL
    const whereMatch = currentSql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|\s+OFFSET|$)/i);
    const orderMatch = currentSql.match(/ORDER\s+BY\s+(.+?)(?:\s+LIMIT|\s+OFFSET|$)/i);
    const whereClause = whereMatch ? ` WHERE ${whereMatch[1].trim()}` : '';
    const orderByClause = orderMatch ? ` ORDER BY ${orderMatch[1].trim()}` : '';
    const limitClause = pageSize > 0 ? ` LIMIT ${pageSize}` : '';
    const offsetClause = page > 0 && pageSize > 0 ? ` OFFSET ${page * pageSize}` : '';

    const sql = `SELECT * FROM ${qt}${whereClause}${orderByClause}${limitClause}${offsetClause}`;
    updateSql(activeTab.id, sql);
    executeQuery(activeConnectionId, activeTab.id);

    // Re-fetch count if pageSize changed (filter might affect it)
    if (whereClause) {
      ipc.executeQueryColumnar(activeConnectionId, `SELECT COUNT(*) AS cnt FROM ${qt}${whereClause}`)
        .then((res) => {
          const count = res.data[0]?.values[0];
          setServerTotalRows(typeof count === 'number' ? count : 0);
        })
        .catch(() => {});
    }
  }, [activeConnectionId, activeTab, dbType, currentSql, updateSql, executeQuery]);

  // Re-query active table tab when page size preference changes (or on remount after settings close)
  useEffect(() => {
    if (!activeConnectionId || !activeTab?.table) return;
    const expectedLimit = defaultPageSize > 0 ? ` LIMIT ${defaultPageSize}` : '';
    const qt = quoteIdentifier(activeTab.table, dbType);
    const expectedSql = `SELECT * FROM ${qt}${expectedLimit}`;
    if (activeTab.sql === expectedSql) return;
    // Only auto-update simple SELECT * queries (don't overwrite custom WHERE/ORDER BY)
    // Match both backtick-quoted and double-quote-quoted identifiers
    const isSimpleSelect = /^SELECT \* FROM [`"][^`"]+[`"](\s+LIMIT \d+)?$/i.test(activeTab.sql);
    if (!isSimpleSelect) return;
    const tabId = activeTab.id;
    const connId = activeConnectionId;
    queueMicrotask(() => {
      updateSql(tabId, expectedSql);
      executeQuery(connId, tabId);
    });
  }, [defaultPageSize, activeConnectionId, activeTab, dbType, updateSql, executeQuery]);

  // No tabs open yet -- show welcome / empty state
  if (tabs.length === 0) {
    return (
      <>
        <WelcomeScreen
          onNewConnection={() => onOpenConnectionDialog?.()}
          onOpenFile={() => createTab()}
        />
        <CodePreview />
      </>
    );
  }

  return (
    <>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <EditorTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTab}
          onCloseTab={closeTab}
          onNewTab={() => createTab()}
        />

        {activeTab && activeTab.viewMode === 'er-diagram' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <ERDiagramView />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'dashboard' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <DashboardView connectionId={activeConnectionId} />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'health' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <HealthDashboard />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'explain' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <ExplainView query={activeTab.sql} />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'query-builder' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <QueryBuilderView />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'migration' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <SchemaMigrationView />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'alerts' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <AlertManager />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'table-designer' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <TableDesigner database={activeTab.database} table={activeTab.table} />
            </Suspense>
          </div>
        )}

        {activeTab && activeTab.viewMode === 'processes' && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <Suspense fallback={<LazyFallback />}>
              <ProcessList />
            </Suspense>
          </div>
        )}

        {activeTab && !['er-diagram', 'dashboard', 'health', 'explain', 'query-builder', 'migration', 'alerts', 'table-designer', 'processes'].includes(activeTab.viewMode) && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {activeTab.editorVisible ? (
              <>
                <EditorToolbar
                  isExecuting={activeTab.isExecuting}
                  onRun={() => {
                    if (activeConnectionId && activeTabId) {
                      executeQuery(activeConnectionId, activeTabId);
                    }
                  }}
                />
                <SplitEditorResults>
                  <SqlEditor
                    value={activeTab.sql}
                    onChange={(val) => updateSql(activeTab.id, val)}
                    onExecute={() => {
                      if (activeConnectionId) {
                        executeQuery(activeConnectionId, activeTab.id);
                      }
                    }}
                  />
                  <>
                    {(tabResult?.allColumnarResults.length ?? 0) > 1 && (
                      <div className="flex items-center gap-0.5 border-b border-border bg-muted/50 px-2 py-0.5">
                        {tabResult!.allColumnarResults.map((r, i) => (
                          <button
                            key={i}
                            onClick={() => setActiveResult(activeTab.id, i)}
                            className={cn(
                              'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                              i === tabResult!.activeResultIndex
                                ? 'bg-primary/10 text-primary'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            Result {i + 1}
                            <span className="ml-1 text-muted-foreground">
                              ({r.row_count} rows)
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                    {tabResult && tabResult.columns.length > 0 && (
                      <FilterBar
                        columns={tabResult.columns}
                        onApply={handleFilterApply}
                        dbType={dbType}
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      {renderResult(activeTab, tabResult, handleServerSort, handleServerPageChange, serverTotalRows, serverPage)}
                    </div>
                  </>
                </SplitEditorResults>
              </>
            ) : (
              <>
                {/* Editor hidden -- show toolbar with Create Query + view toggle */}
                <div
                  className="flex items-center gap-2 border-b border-border bg-muted px-3"
                  style={{ height: 'var(--toolbar-height)' }}
                >
                  <Button onClick={handleCreateQuery} size="xs">
                    Create Query
                  </Button>
                  {activeTab.table && (
                    <div className="ml-2 flex items-center rounded-md border border-border bg-background p-0.5">
                      <button
                        onClick={() => setViewMode(activeTab.id, 'data')}
                        className={cn(
                          'flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors',
                          activeTab.viewMode === 'data'
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Table2 className="h-3 w-3" />
                        Data
                      </button>
                      <button
                        onClick={() => setViewMode(activeTab.id, 'structure')}
                        className={cn(
                          'flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors',
                          activeTab.viewMode === 'structure'
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <Columns3 className="h-3 w-3" />
                        Structure
                      </button>
                    </div>
                  )}
                  {activeTab.isExecuting && (
                    <span className="text-xs text-muted-foreground">
                      Executing...
                    </span>
                  )}
                </div>
                {activeTab.viewMode === 'structure' && activeTab.database && activeTab.table ? (
                  <div className="flex-1 overflow-hidden">
                    <ErrorBoundary>
                      <TableStructureView database={activeTab.database} table={activeTab.table} />
                    </ErrorBoundary>
                  </div>
                ) : (
                  <>
                    {tabResult && tabResult.columns.length > 0 && (
                      <FilterBar
                        columns={tabResult.columns}
                        onApply={handleFilterApply}
                        dbType={dbType}
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      {renderResult(activeTab, tabResult, handleServerSort, handleServerPageChange, serverTotalRows, serverPage)}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {tabResult && tabResult.columns.length > 0 && (
        <ColumnFilter columns={tabResult.columns} />
      )}
      <CodePreview />
    </>
  );
}

function renderResult(
  tab: QueryTab,
  tabResult: TabResult | undefined,
  onServerSort?: (sorts: SortRequest[]) => void,
  onServerPageChange?: (page: number, pageSize: number) => void,
  serverTotalRows?: number,
  serverPage?: number,
) {
  if (tabResult?.error) {
    return (
      <div className="p-4 text-sm text-destructive">
        {tabResult.error}
      </div>
    );
  }
  const allResults = tabResult ? useResultStore.getState().getAllResults(tab.id) : [];
  const activeQueryResult = allResults[tabResult?.activeResultIndex ?? 0] ?? null;
  if (activeQueryResult) {
    const isReloading = tabResult?.isExecuting ?? tab.isExecuting;
    return (
      <ErrorBoundary>
        <div className="relative h-full">
          <DataGrid
            result={activeQueryResult}
            database={tab.database}
            table={tab.table}
            onServerSort={tab.table ? onServerSort : undefined}
            onServerPageChange={tab.table ? onServerPageChange : undefined}
            serverTotalRows={tab.table ? serverTotalRows : undefined}
            serverPage={tab.table ? serverPage : undefined}
          />
          {isReloading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/40">
              <p className="text-sm text-muted-foreground">Loading...</p>
            </div>
          )}
        </div>
      </ErrorBoundary>
    );
  }
  if (tab.isExecuting || tabResult?.isExecuting) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Loading...</p>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p className="text-sm">Run a query to see results</p>
    </div>
  );
}
