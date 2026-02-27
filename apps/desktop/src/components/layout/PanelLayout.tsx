import { useQueryStore } from '@/stores/queryStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { EditorTabs } from '@/components/editor/EditorTabs';
import { SqlEditor } from '@/components/editor/SqlEditor';
import { EditorToolbar } from '@/components/editor/EditorToolbar';
import { DataGrid } from '@/components/grid/DataGrid';

export function PanelLayout() {
  const { tabs, activeTabId, updateSql, executeQuery, createTab, closeTab, setActiveTab } = useQueryStore();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <EditorTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTab}
        onCloseTab={closeTab}
        onNewTab={() => createTab()}
      />

      {activeTab && (
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
            <div className="flex-1 overflow-hidden" style={{ minHeight: '200px' }}>
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
            <div
              className="flex-1 overflow-hidden border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              {activeTab.error ? (
                <div className="p-4 text-sm" style={{ color: 'var(--color-error)' }}>
                  {activeTab.error}
                </div>
              ) : activeTab.result ? (
                <DataGrid result={activeTab.result} />
              ) : (
                <div className="flex h-full items-center justify-center" style={{ color: 'var(--color-text-disabled)' }}>
                  <p className="text-sm">Run a query to see results</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
