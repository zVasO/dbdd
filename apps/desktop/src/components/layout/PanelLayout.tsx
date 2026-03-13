import { useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
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
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const tabResult = useResultStore((s) => activeTab ? s.results[activeTab.id] : undefined);

  const { updateSql, executeQuery, createTab, closeTab, setActiveTab: setPrimaryActiveTab, setEditorVisible, setViewMode, setActiveResult } = useQueryStore.getState();
  const setSecondaryActiveTab = useUIStore.getState().setSecondaryActiveTabId;
  const setActiveTab = paneId === 'secondary' ? setSecondaryActiveTab : setPrimaryActiveTab;

  const handleCreateQuery = () => {
    createTab();
  };

  const handleFilterApply = useCallback((whereClause: string) => {
    if (!activeConnectionId || !activeTab?.table || !activeTab?.database) return;
    const base = `SELECT * FROM \`${activeTab.table}\``;
    const pageSize = usePreferencesStore.getState().defaultPageSize;
    const limit = pageSize > 0 ? ` LIMIT ${pageSize}` : '';
    const sql = whereClause ? `${base} WHERE ${whereClause}${limit}` : `${base}${limit}`;
    updateSql(activeTab.id, sql);
    executeQuery(activeConnectionId, activeTab.id);
  }, [activeConnectionId, activeTab, updateSql, executeQuery]);

  const buildTableSql = (tableName: string, sorts: SortRequest[]): string => {
    // Preserve existing WHERE clause from current SQL
    const currentSql = activeTab?.sql ?? '';
    const whereMatch = currentSql.match(/WHERE\s+(.+?)(?:\s+ORDER\s+BY|\s+LIMIT|$)/i);
    const whereClause = whereMatch ? ` WHERE ${whereMatch[1].trim()}` : '';

    const orderByClause = sorts.length > 0
      ? ` ORDER BY ${sorts.map((s) => `\`${s.column}\` ${s.direction.toUpperCase()}`).join(', ')}`
      : '';

    const pageSize = usePreferencesStore.getState().defaultPageSize;
    const limitClause = pageSize > 0 ? ` LIMIT ${pageSize}` : '';
    return `SELECT * FROM \`${tableName}\`${whereClause}${orderByClause}${limitClause}`;
  };

  const handleServerSort = useCallback((sorts: SortRequest[]) => {
    if (!activeConnectionId || !activeTab?.table || !activeTab?.database) return;
    const sql = buildTableSql(activeTab.table, sorts);
    updateSql(activeTab.id, sql);
    executeQuery(activeConnectionId, activeTab.id);
  }, [activeConnectionId, activeTab, updateSql, executeQuery]);

  // Re-query active table tab when page size preference changes (or on remount after settings close)
  const defaultPageSize = usePreferencesStore((s) => s.defaultPageSize);
  useEffect(() => {
    if (!activeConnectionId || !activeTab?.table) return;
    const expectedLimit = defaultPageSize > 0 ? ` LIMIT ${defaultPageSize}` : '';
    const expectedSql = `SELECT * FROM \`${activeTab.table}\`${expectedLimit}`;
    if (activeTab.sql === expectedSql) return;
    // Only auto-update simple SELECT * queries (don't overwrite custom WHERE/ORDER BY)
    const isSimpleSelect = /^SELECT \* FROM `[^`]+`(\s+LIMIT \d+)?$/i.test(activeTab.sql);
    if (!isSimpleSelect) return;
    updateSql(activeTab.id, expectedSql);
    executeQuery(activeConnectionId, activeTab.id);
  }, [defaultPageSize]);

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
                <div className="flex flex-1 flex-col overflow-hidden">
                  <div className="overflow-hidden" style={{ minHeight: '150px', height: '40%' }}>
                    <SqlEditor
                      value={activeTab.sql}
                      onChange={(val) => updateSql(activeTab.id, val)}
                      onExecute={() => {
                        if (activeConnectionId) {
                          executeQuery(activeConnectionId, activeTab.id);
                        }
                      }}
                    />
                  </div>
                  <div className="flex-1 flex flex-col overflow-hidden border-t border-border">
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
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      {renderResult(activeTab, tabResult, handleServerSort)}
                    </div>
                  </div>
                </div>
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
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      {renderResult(activeTab, tabResult, handleServerSort)}
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

function renderResult(tab: QueryTab, tabResult: TabResult | undefined, onServerSort?: (sorts: SortRequest[]) => void) {
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
          <DataGrid result={activeQueryResult} database={tab.database} table={tab.table} onServerSort={tab.table ? onServerSort : undefined} />
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
