import { useState, useEffect, useRef } from 'react';
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
import { PreferencesDialog } from './PreferencesDialog';
import { CsvImportDialog } from '@/components/editor/CsvImportDialog';
import { SettingsPage } from '@/components/settings/SettingsPage';
import { AiChatPanel } from '@/components/ai/AiChatPanel';
import { SnippetPalette } from '@/components/snippets/SnippetPalette';
import { useAIStore } from '@/stores/aiStore';
import { openSqlFile, saveSqlFile } from '@/lib/fileOps';

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

  const [prefsOpen, setPrefsOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [snippetPaletteOpen, setSnippetPaletteOpen] = useState(false);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
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
    {
      key: ',',
      modifiers: ['ctrl'],
      handler: () => setPrefsOpen(true),
    },
    {
      key: 'o',
      modifiers: ['ctrl'],
      handler: async () => {
        const file = await openSqlFile();
        if (!file) return;
        const { createTab, tabs, activeTabId, updateSql } = useQueryStore.getState();
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab && !activeTab.sql.trim()) {
          updateSql(activeTab.id, file.content);
        } else {
          const id = createTab(file.name, { editorVisible: true });
          useQueryStore.getState().updateSql(id, file.content);
        }
      },
    },
    {
      key: 's',
      modifiers: ['ctrl', 'shift'],
      handler: () => {
        const { tabs, activeTabId } = useQueryStore.getState();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab?.sql) {
          saveSqlFile(tab.sql, `${tab.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.sql`);
        }
      },
    },
    {
      key: 'j',
      modifiers: ['ctrl'],
      handler: () => {
        const store = useAIStore.getState();
        store.setChatOpen(!store.chatOpen);
      },
    },
    {
      key: 'i',
      modifiers: ['ctrl', 'shift'],
      handler: () => setSnippetPaletteOpen(true),
    },
  ]);

  if (settingsOpen) {
    return <SettingsPage onClose={() => setSettingsOpen(false)} />;
  }

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
        <AiChatPanel />
      </div>
      <ActivityBar />
      <StatusBar
        connected={!!activeConnectionId}
        dbType={activeConfig?.db_type}
        onDisconnect={disconnect}
      />
      <CommandPalette onOpenPreferences={() => setPrefsOpen(true)} onOpenCsvImport={() => setCsvImportOpen(true)} />
      <OpenAnything />
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} onOpenSettings={() => setSettingsOpen(true)} />
      <CsvImportDialog open={csvImportOpen} onOpenChange={setCsvImportOpen} />
      <SnippetPalette
        open={snippetPaletteOpen}
        onOpenChange={setSnippetPaletteOpen}
        onInsert={(sql) => {
          const { tabs, activeTabId, updateSql, createTab } = useQueryStore.getState();
          const activeTab = tabs.find((t) => t.id === activeTabId);
          if (activeTab) {
            updateSql(activeTab.id, activeTab.sql ? `${activeTab.sql}\n${sql}` : sql);
          } else {
            const id = createTab('Snippet');
            useQueryStore.getState().updateSql(id, sql);
          }
        }}
      />
    </div>
  );
}
