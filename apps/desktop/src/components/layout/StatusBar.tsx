import { useQueryStore } from '@/stores/queryStore';
import { ConnectionStatus } from '@/components/connection/ConnectionStatus';

interface Props {
  connected: boolean;
  dbType?: string;
  onDisconnect: () => void;
}

export function StatusBar({ connected, dbType, onDisconnect }: Props) {
  const activeTabId = useQueryStore((s) => s.activeTabId);
  const tabs = useQueryStore((s) => s.tabs);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  return (
    <div
      className="flex items-center justify-between border-t px-3"
      style={{
        height: 'var(--statusbar-height)',
        background: 'var(--color-bg-secondary)',
        borderColor: 'var(--color-border)',
        color: 'var(--color-text-tertiary)',
        fontSize: '11px',
      }}
    >
      <div className="flex items-center gap-4">
        <ConnectionStatus connected={connected} dbType={dbType} />
        {connected && (
          <button
            onClick={onDisconnect}
            className="hover:underline"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Disconnect
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        {activeTab?.result && (
          <>
            <span>{activeTab.result.rows.length} rows</span>
            <span>{activeTab.result.execution_time_ms}ms</span>
          </>
        )}
        {activeTab?.isExecuting && <span>Executing...</span>}
      </div>
    </div>
  );
}
