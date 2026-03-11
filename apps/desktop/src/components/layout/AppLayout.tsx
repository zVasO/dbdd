import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useUIStore } from '@/stores/uiStore';
import { useChangeStore } from '@/stores/changeStore';
import { useFilterStore } from '@/stores/filterStore';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcut';
import { useShortcutStore } from '@/stores/shortcutStore';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { PanelLayout } from './PanelLayout';
import { ActivityBar } from './ActivityBar';
import { CommandPalette } from './CommandPalette';
import { OpenAnything } from './OpenAnything';
import { PreferencesDialog } from './PreferencesDialog';
import { useAIStore } from '@/stores/aiStore';
import { openSqlFile, saveSqlFile } from '@/lib/fileOps';

const CsvImportDialog = lazy(() => import('@/components/editor/CsvImportDialog').then(m => ({ default: m.CsvImportDialog })));
const SettingsPage = lazy(() => import('@/components/settings/SettingsPage').then(m => ({ default: m.SettingsPage })));
const AiChatPanel = lazy(() => import('@/components/ai/AiChatPanel').then(m => ({ default: m.AiChatPanel })));
const SnippetPalette = lazy(() => import('@/components/snippets/SnippetPalette').then(m => ({ default: m.SnippetPalette })));
const ConnectionDialog = lazy(() => import('@/components/connection/ConnectionDialog').then(m => ({ default: m.ConnectionDialog })));
const ImportDialog = lazy(() => import('@/components/import-export/ImportDialog').then(m => ({ default: m.ImportDialog })));
const ExportDialog = lazy(() => import('@/components/import-export/ExportDialog').then(m => ({ default: m.ExportDialog })));
const DataGeneratorDialog = lazy(() => import('@/components/data-gen/DataGeneratorDialog').then(m => ({ default: m.DataGeneratorDialog })));
const ShareDialog = lazy(() => import('@/components/sharing/ShareDialog').then(m => ({ default: m.ShareDialog })));
const NotesPanel = lazy(() => import('@/components/notes/NotesPanel').then(m => ({ default: m.NotesPanel })));
import { useImportExportStore } from '@/stores/importExportStore';
import { useDataGenStore } from '@/stores/dataGenStore';
import { useNotesStore } from '@/stores/notesStore';

export function AppLayout() {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const disconnect = useConnectionStore((s) => s.disconnect);
  const loadDatabases = useSchemaStore((s) => s.loadDatabases);
  const createTab = useQueryStore((s) => s.createTab);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const [prefsOpen, setPrefsOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [snippetPaletteOpen, setSnippetPaletteOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const handleOpenConnectionDialog = useCallback(() => setConnectionDialogOpen(true), []);
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const isDragging = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(180, Math.min(500, e.clientX));
      // Update CSS variable directly — avoids React re-render per pixel
      document.documentElement.style.setProperty('--sidebar-width', `${newWidth}px`);
    };
    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        // Commit final width to store once on release
        const current = document.documentElement.style.getPropertyValue('--sidebar-width');
        const finalWidth = parseInt(current, 10);
        if (finalWidth) setSidebarWidth(finalWidth);
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
      // Clear stale schema from previous connection before loading new one
      useSchemaStore.getState().reset();
      useChangeStore.getState().discard();
      loadDatabases(activeConnectionId).then(() => {
        // Auto-select the configured database (or first available)
        const { databases, setActiveDatabase } = useSchemaStore.getState();
        const targetDb = activeConfig?.database
          || databases[0]?.name;
        if (targetDb) {
          setActiveDatabase(targetDb);
          useSchemaStore.getState().loadTables(activeConnectionId, targetDb);
        }
      });
    } else {
      // No active connection — clear everything
      useSchemaStore.getState().reset();
      useChangeStore.getState().discard();
    }
  }, [activeConnectionId, loadDatabases, activeConfig?.database]);

  // Re-render when shortcut overrides change
  const _shortcutOverrides = useShortcutStore((s) => s.overrides);
  const sc = useShortcutStore((s) => s.getBinding);

  useKeyboardShortcuts([
    { ...sc('global.newTab'), handler: () => createTab() },
    { ...sc('global.openAnything'), handler: () => useUIStore.getState().setOpenAnythingOpen(true) },
    { ...sc('global.commandPalette'), handler: () => useUIStore.getState().setCommandPaletteOpen(true) },
    { ...sc('global.toggleSidebar'), handler: () => toggleSidebar() },
    {
      ...sc('global.closeTab'),
      handler: () => {
        const { activeTabId, closeTab } = useQueryStore.getState();
        if (activeTabId) closeTab(activeTabId);
      },
    },
    {
      ...sc('global.save'),
      handler: () => {
        document.dispatchEvent(new CustomEvent('dataforge:commit'));
      },
    },
    { ...sc('global.redo'), handler: () => useChangeStore.getState().redo() },
    { ...sc('global.undo'), handler: () => useChangeStore.getState().undo() },
    {
      ...sc('global.previewChanges'),
      handler: () => {
        const store = useChangeStore.getState();
        if (store.hasPendingChanges()) store.setPreviewOpen(true);
      },
    },
    {
      ...sc('global.columnFilter'),
      handler: () => {
        const store = useFilterStore.getState();
        store.setColumnFilterOpen(!store.columnFilterOpen);
      },
    },
    {
      ...sc('global.searchFilter'),
      handler: () => {
        const store = useFilterStore.getState();
        store.setFilterBarOpen(!store.filterBarOpen);
      },
    },
    { ...sc('global.preferences'), handler: () => setPrefsOpen(true) },
    {
      ...sc('global.openFile'),
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
      ...sc('global.saveFile'),
      handler: () => {
        const { tabs, activeTabId } = useQueryStore.getState();
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab?.sql) {
          saveSqlFile(tab.sql, `${tab.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.sql`);
        }
      },
    },
    {
      ...sc('global.aiAssistant'),
      handler: () => {
        const store = useAIStore.getState();
        store.setChatOpen(!store.chatOpen);
      },
    },
    { ...sc('global.insertSnippet'), handler: () => setSnippetPaletteOpen(true) },
    { ...sc('global.export'), handler: () => useImportExportStore.getState().setExportDialogOpen(true) },
    { ...sc('global.dataGenerator'), handler: () => useDataGenStore.getState().setDialogOpen(true) },
  ]);

  if (settingsOpen) {
    return (
      <Suspense fallback={null}>
        <SettingsPage onClose={() => setSettingsOpen(false)} />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onOpenConnectionDialog={handleOpenConnectionDialog} />
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
        <Suspense fallback={null}>
          <AiChatPanel />
        </Suspense>
      </div>
      <ActivityBar />
      <StatusBar
        connected={!!activeConnectionId}
        dbType={activeConfig?.db_type}
        onDisconnect={disconnect}
        onOpenConnectionDialog={handleOpenConnectionDialog}
      />
      <CommandPalette onOpenPreferences={() => setPrefsOpen(true)} onOpenCsvImport={() => setCsvImportOpen(true)} onOpenConnectionDialog={handleOpenConnectionDialog} />
      <OpenAnything />
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} onOpenSettings={() => setSettingsOpen(true)} />
      <Suspense fallback={null}>
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
        <ImportDialog />
        <ExportDialog />
        <DataGeneratorDialog />
        <ShareDialog open={shareDialogOpen} onOpenChange={setShareDialogOpen} />
        <ConnectionDialog open={connectionDialogOpen} onOpenChange={setConnectionDialogOpen} />
        <NotesPanel />
      </Suspense>
    </div>
  );
}
