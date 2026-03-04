import { useEffect, useRef } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useUIStore } from '@/stores/uiStore';
import { useChangeStore } from '@/stores/changeStore';
import { useFilterStore } from '@/stores/filterStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcut';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { PanelLayout } from './PanelLayout';
import { ActivityBar } from './ActivityBar';
import { CommandPalette } from './CommandPalette';
import { OpenAnything } from './OpenAnything';

export function AppLayout() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const loadDatabases = useSchemaStore((s) => s.loadDatabases);
  const { createTab } = useQueryStore();
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const isDragging = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(180, Math.min(500, e.clientX));
      setSidebarWidth(newWidth);
      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setSidebarWidth]);

  useEffect(() => {
    if (activeConnectionId) {
      loadDatabases(activeConnectionId);
    }
  }, [activeConnectionId, loadDatabases]);

  useKeyboardShortcuts([
    {
      key: 'n',
      modifiers: ['ctrl'],
      handler: () => createTab(),
    },
    {
      key: 'p',
      modifiers: ['ctrl'],
      handler: () => useUIStore.getState().setOpenAnythingOpen(true),
    },
    {
      key: 'k',
      modifiers: ['ctrl'],
      handler: () => useUIStore.getState().setCommandPaletteOpen(true),
    },
    {
      key: 'b',
      modifiers: ['ctrl'],
      handler: () => toggleSidebar(),
    },
    {
      key: 'w',
      modifiers: ['ctrl'],
      handler: () => {
        const { activeTabId, closeTab } = useQueryStore.getState();
        if (activeTabId) closeTab(activeTabId);
      },
    },
    {
      key: 's',
      modifiers: ['ctrl'],
      handler: () => {
        document.dispatchEvent(new CustomEvent('dataforge:commit'));
      },
    },
    {
      key: 'z',
      modifiers: ['ctrl', 'shift'],
      handler: () => useChangeStore.getState().redo(),
    },
    {
      key: 'z',
      modifiers: ['ctrl'],
      handler: () => useChangeStore.getState().undo(),
    },
    {
      key: 'p',
      modifiers: ['ctrl', 'shift'],
      handler: () => {
        const store = useChangeStore.getState();
        if (store.hasPendingChanges()) store.setPreviewOpen(true);
      },
    },
    {
      key: 'f',
      modifiers: ['ctrl', 'alt'],
      handler: () => {
        const store = useFilterStore.getState();
        store.setColumnFilterOpen(!store.columnFilterOpen);
      },
    },
    {
      key: 'f',
      modifiers: ['ctrl'],
      handler: () => {
        const store = useFilterStore.getState();
        store.setFilterBarOpen(!store.filterBarOpen);
      },
    },
  ]);

  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        {sidebarOpen && (
          <div
            className="w-1 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors"
            onMouseDown={(e) => {
              e.preventDefault();
              isDragging.current = true;
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
          />
        )}
        <PanelLayout />
      </div>
      <ActivityBar />
      <StatusBar
        connected={!!activeConnectionId}
        dbType={activeConfig?.db_type}
        onDisconnect={disconnect}
      />
      <CommandPalette />
      <OpenAnything />
    </div>
  );
}
