import { useEffect } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useUIStore } from '@/stores/uiStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcut';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { PanelLayout } from './PanelLayout';

export function AppLayout() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const loadDatabases = useSchemaStore((s) => s.loadDatabases);
  const { createTab, tabs } = useQueryStore();

  useEffect(() => {
    if (activeConnectionId) {
      loadDatabases(activeConnectionId);
      if (tabs.length === 0) {
        createTab();
      }
    }
  }, [activeConnectionId, loadDatabases, createTab, tabs.length]);

  useKeyboardShortcuts([
    {
      key: 'n',
      modifiers: ['ctrl'],
      handler: () => createTab(),
    },
    {
      key: 'k',
      modifiers: ['ctrl'],
      handler: () => useUIStore.getState().setCommandPaletteOpen(true),
    },
  ]);

  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--color-bg-primary)' }}>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <PanelLayout />
      </div>
      <StatusBar
        connected={!!activeConnectionId}
        dbType={activeConfig?.db_type}
        onDisconnect={disconnect}
      />
    </div>
  );
}
