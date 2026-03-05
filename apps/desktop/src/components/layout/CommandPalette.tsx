import { Command } from 'cmdk';
import { useUIStore } from '@/stores/uiStore';
import { useQueryStore } from '@/stores/queryStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useActivityStore } from '@/stores/activityStore';
import {
  Plus,
  Play,
  X,
  PanelLeft,
  Moon,
  Terminal,
  Unplug,
  Settings,
  FolderOpen,
  Save,
  Upload,
  GitBranch,
  LayoutDashboard,
  Activity,
  Sparkles,
  Code2,
  Workflow,
  Download,
  ArrowLeftRight,
  Bell,
  Share2,
  StickyNote,
  Database,
  TableProperties,
  Users,
} from 'lucide-react';
import { openSqlFile, saveSqlFile } from '@/lib/fileOps';
import { useAIStore } from '@/stores/aiStore';
import { useImportExportStore } from '@/stores/importExportStore';
import { useDataGenStore } from '@/stores/dataGenStore';
import { useNotesStore } from '@/stores/notesStore';
import { useShortcutStore, formatBinding } from '@/stores/shortcutStore';

interface CommandPaletteProps {
  onOpenPreferences?: () => void;
  onOpenCsvImport?: () => void;
}

export function CommandPalette({ onOpenPreferences, onOpenCsvImport }: CommandPaletteProps) {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const sc = useShortcutStore((s) => s.getBinding);
  // Subscribe to overrides so display updates when shortcuts change
  useShortcutStore((s) => s.overrides);

  function runAndClose(fn: () => void) {
    fn();
    setOpen(false);
  }

  function handleNewQuery() {
    runAndClose(() => useQueryStore.getState().createTab());
  }

  function handleRunQuery() {
    runAndClose(() => {
      const { activeTabId, executeQuery } = useQueryStore.getState();
      const connectionId = useConnectionStore.getState().activeConnectionId;
      if (activeTabId && connectionId) {
        executeQuery(connectionId, activeTabId);
      }
    });
  }

  function handleCloseTab() {
    runAndClose(() => {
      const { activeTabId, closeTab } = useQueryStore.getState();
      if (activeTabId) closeTab(activeTabId);
    });
  }

  function handleToggleSidebar() {
    runAndClose(() => useUIStore.getState().toggleSidebar());
  }

  function handleToggleTheme() {
    runAndClose(() => useUIStore.getState().toggleTheme());
  }

  function handleToggleActivityLog() {
    runAndClose(() => useActivityStore.getState().toggleExpanded());
  }

  function handleDisconnect() {
    runAndClose(() => {
      useConnectionStore.getState().disconnect();
    });
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className="fixed inset-0 z-50"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />

      {/* Dialog container */}
      <div className="fixed inset-0 flex items-start justify-center pt-[20vh]">
        <div className="relative w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
          <Command.Input
            placeholder="Type a command or search..."
            className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground"
          />

          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-6 text-center text-sm text-muted-foreground">
              No results found.
            </Command.Empty>

            {/* Query group */}
            <Command.Group
              heading="Query"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                onSelect={handleNewQuery}
                icon={<Plus className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.newTab'))}
              >
                New Query Tab
              </CommandItem>
              <CommandItem
                onSelect={handleRunQuery}
                icon={<Play className="h-4 w-4" />}
                shortcut={formatBinding(sc('editor.execute'))}
              >
                Run Query
              </CommandItem>
              <CommandItem
                onSelect={handleCloseTab}
                icon={<X className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.closeTab'))}
              >
                Close Tab
              </CommandItem>
            </Command.Group>

            {/* View group */}
            <Command.Group
              heading="View"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                onSelect={handleToggleSidebar}
                icon={<PanelLeft className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.toggleSidebar'))}
              >
                Toggle Sidebar
              </CommandItem>
              <CommandItem
                onSelect={handleToggleTheme}
                icon={<Moon className="h-4 w-4" />}
              >
                Toggle Theme
              </CommandItem>
              <CommandItem
                onSelect={handleToggleActivityLog}
                icon={<Terminal className="h-4 w-4" />}
              >
                Toggle Activity Log
              </CommandItem>
              {onOpenPreferences && (
                <CommandItem
                  onSelect={() => runAndClose(() => onOpenPreferences())}
                  icon={<Settings className="h-4 w-4" />}
                  shortcut={formatBinding(sc('global.preferences'))}
                >
                  Preferences
                </CommandItem>
              )}
              <CommandItem
                onSelect={() => runAndClose(() => useUIStore.getState().setSettingsOpen(true))}
                icon={<Settings className="h-4 w-4" />}
              >
                Open Settings
              </CommandItem>
            </Command.Group>

            {/* File group */}
            <Command.Group
              heading="File"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                onSelect={() => runAndClose(async () => {
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
                })}
                icon={<FolderOpen className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.openFile'))}
              >
                Open SQL File
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const { tabs, activeTabId } = useQueryStore.getState();
                  const tab = tabs.find((t) => t.id === activeTabId);
                  if (tab?.sql) saveSqlFile(tab.sql, `${tab.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.sql`);
                })}
                icon={<Save className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.saveFile'))}
              >
                Save SQL File
              </CommandItem>
              {onOpenCsvImport && (
                <CommandItem
                  onSelect={() => runAndClose(() => onOpenCsvImport())}
                  icon={<Upload className="h-4 w-4" />}
                >
                  Import CSV
                </CommandItem>
              )}
            </Command.Group>

            {/* Features group */}
            <Command.Group
              heading="Features"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('ER Diagram', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'er-diagram');
                })}
                icon={<GitBranch className="h-4 w-4" />}
              >
                Open ER Diagram
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('Dashboard', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'dashboard');
                })}
                icon={<LayoutDashboard className="h-4 w-4" />}
              >
                New Dashboard
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('Health Monitor', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'health');
                })}
                icon={<Activity className="h-4 w-4" />}
              >
                Database Health Monitor
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  useAIStore.getState().setChatOpen(true);
                })}
                icon={<Sparkles className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.aiAssistant'))}
              >
                AI Assistant
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  document.dispatchEvent(new CustomEvent('dataforge:snippet-palette'));
                })}
                icon={<Code2 className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.insertSnippet'))}
              >
                Insert Snippet
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('Query Builder', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'query-builder');
                })}
                icon={<Workflow className="h-4 w-4" />}
              >
                Visual Query Builder
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('Schema Migration', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'migration');
                })}
                icon={<ArrowLeftRight className="h-4 w-4" />}
              >
                Schema Migration
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('Alerts', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'alerts');
                })}
                icon={<Bell className="h-4 w-4" />}
              >
                Manage Alerts
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => useImportExportStore.getState().setImportDialogOpen(true))}
                icon={<Upload className="h-4 w-4" />}
              >
                Import Data
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => useImportExportStore.getState().setExportDialogOpen(true))}
                icon={<Download className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.export'))}
              >
                Export Data
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => useDataGenStore.getState().setDialogOpen(true))}
                icon={<Database className="h-4 w-4" />}
                shortcut={formatBinding(sc('global.dataGenerator'))}
              >
                Generate Mock Data
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => useNotesStore.getState().setPanelOpen(true))}
                icon={<StickyNote className="h-4 w-4" />}
              >
                Notes & Annotations
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  document.dispatchEvent(new CustomEvent('dataforge:share-dialog'));
                })}
                icon={<Share2 className="h-4 w-4" />}
              >
                Share / Import
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('Table Designer', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'table-designer');
                })}
                icon={<TableProperties className="h-4 w-4" />}
              >
                Table Designer
              </CommandItem>
              <CommandItem
                onSelect={() => runAndClose(() => {
                  const id = useQueryStore.getState().createTab('Server Processes', { editorVisible: false });
                  useQueryStore.getState().setViewMode(id, 'processes');
                })}
                icon={<Users className="h-4 w-4" />}
              >
                Server Processes
              </CommandItem>
            </Command.Group>

            {/* Connection group */}
            <Command.Group
              heading="Connection"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              <CommandItem
                onSelect={handleDisconnect}
                icon={<Unplug className="h-4 w-4" />}
              >
                Disconnect
              </CommandItem>
            </Command.Group>
          </Command.List>
        </div>
      </div>
    </Command.Dialog>
  );
}

function CommandItem({
  children,
  icon,
  shortcut,
  onSelect,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  shortcut?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm text-popover-foreground aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="flex-1">{children}</span>
      {shortcut && (
        <kbd className="ml-auto shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
