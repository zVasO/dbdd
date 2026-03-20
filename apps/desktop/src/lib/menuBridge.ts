import { listen } from '@tauri-apps/api/event';
import { useQueryStore } from '@/stores/queryStore';
import { useUIStore } from '@/stores/uiStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useActivityStore } from '@/stores/activityStore';

type MenuHandler = () => void;

const menuHandlers: Record<string, MenuHandler> = {
  // File
  new_tab: () => useQueryStore.getState().createTab(),
  open_file: () => window.dispatchEvent(new CustomEvent('vasodb:open-file')),
  save: () => window.dispatchEvent(new CustomEvent('vasodb:commit')),
  save_as: () => window.dispatchEvent(new CustomEvent('vasodb:save-file')),
  import_csv: () => window.dispatchEvent(new CustomEvent('vasodb:import-csv')),
  export: () => window.dispatchEvent(new CustomEvent('vasodb:export')),
  close_tab: () => {
    const store = useQueryStore.getState();
    const tabId = store.activeTabId;
    if (tabId) {
      store.closeTab(tabId);
    } else {
      console.warn('[menuBridge] close_tab: no active tab to close');
    }
  },

  // Edit (only custom items — predefined items like Undo/Copy are handled by the OS)
  find: () => window.dispatchEvent(new CustomEvent('vasodb:search-filter')),
  insert_snippet: () => window.dispatchEvent(new CustomEvent('vasodb:insert-snippet')),

  // Query
  execute_query: () => window.dispatchEvent(new CustomEvent('vasodb:execute-query')),
  format_sql: () => window.dispatchEvent(new CustomEvent('vasodb:format-sql')),
  toggle_comment: () => window.dispatchEvent(new CustomEvent('vasodb:toggle-comment')),
  generate_data: () => window.dispatchEvent(new CustomEvent('vasodb:generate-data')),
  preview_changes: () => window.dispatchEvent(new CustomEvent('vasodb:preview-changes')),

  // View
  toggle_sidebar: () => useUIStore.getState().toggleSidebar(),
  toggle_activity: () => useActivityStore.getState().toggleExpanded(),
  column_filter: () => window.dispatchEvent(new CustomEvent('vasodb:column-filter')),
  command_palette: () => useUIStore.getState().setCommandPaletteOpen(true),
  open_anything: () => useUIStore.getState().setOpenAnythingOpen(true),
  ai_assistant: () => window.dispatchEvent(new CustomEvent('vasodb:ai-assistant')),
  toggle_theme: () => useUIStore.getState().toggleTheme(),

  // Connection
  manage_connections: () => window.dispatchEvent(new CustomEvent('vasodb:manage-connections')),
  disconnect: () => {
    const { activeConnectionId, disconnect } = useConnectionStore.getState();
    if (activeConnectionId) disconnect();
  },

  // Preferences
  preferences: () => window.dispatchEvent(new CustomEvent('vasodb:preferences')),

  // Help
  help: () => window.dispatchEvent(new CustomEvent('vasodb:help')),

  // Window — "bring_all_to_front" is our custom item
  bring_all_to_front: () => {
    // No-op in single-window app, but keep for future multi-window
  },
};

let unlisten: (() => void) | null = null;

export async function setupMenuBridge(): Promise<void> {
  if (unlisten) return;

  unlisten = await listen<string>('menu-event', (event) => {
    const handler = menuHandlers[event.payload];
    if (handler) {
      handler();
    } else {
      console.warn('[menuBridge] Unhandled menu event:', event.payload);
    }
  });
}

export function teardownMenuBridge(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
