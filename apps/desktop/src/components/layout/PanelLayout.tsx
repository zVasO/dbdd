import { useQueryStore } from '@/stores/queryStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { EditorTabs } from '@/components/editor/EditorTabs';
import { SqlEditor } from '@/components/editor/SqlEditor';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { DataGrid } from '@/components/grid/DataGrid';
import { CodePreview } from '@/components/editor/CodePreview';
import { Button } from '@/components/ui/button';
import type { QueryResult } from '@/lib/types';

export function PanelLayout() {
  const { tabs, activeTabId, updateSql, executeQuery, createTab, closeTab, setActiveTab, setEditorVisible } = useQueryStore();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const handleCreateQuery = () => {
    if (activeTab) {
      setEditorVisible(activeTab.id, true);
    } else {
      createTab();
    }
  };

  // No tabs open yet -- show empty state
  if (tabs.length === 0) {
    return (
      <>
        <div className="flex flex-1 flex-col items-center justify-center text-muted-foreground">
          <p className="mb-4 text-sm">Select a table from the sidebar, or create a query</p>
          <Button onClick={() => createTab()}>
            Create Query
          </Button>
        </div>
        <CodePreview />
      </>
    );
  }

  return (
    <>
      <div className="flex flex-1 flex-col overflow-hidden">
        <EditorTabs
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={setActiveTab}
          onCloseTab={closeTab}
          onNewTab={() => createTab()}
        />

        {activeTab && (
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
                  <div className="flex-1 overflow-hidden border-t border-border">
                    {renderResult(activeTab)}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Editor hidden -- show toolbar with Create Query button */}
                <div
                  className="flex items-center gap-2 border-b border-border bg-muted px-3"
                  style={{ height: 'var(--toolbar-height)' }}
                >
                  <Button onClick={handleCreateQuery} size="xs">
                    Create Query
                  </Button>
                  {activeTab.isExecuting && (
                    <span className="text-xs text-muted-foreground">
                      Executing...
                    </span>
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  {renderResult(activeTab)}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <CodePreview />
    </>
  );
}

function renderResult(tab: { error: string | null; result: QueryResult | null; isExecuting: boolean }) {
  if (tab.error) {
    return (
      <div className="p-4 text-sm text-destructive">
        {tab.error}
      </div>
    );
  }
  if (tab.result) {
    return <DataGrid result={tab.result} />;
  }
  if (tab.isExecuting) {
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
