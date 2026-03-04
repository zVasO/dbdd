import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import { useActivityStore } from './activityStore';
import { useConnectionStore } from './connectionStore';
import { saveSession } from '../lib/sessionRecovery';
import type { QueryResult, QueryHistoryEntry } from '../lib/types';

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
  editorVisible: boolean;
  database?: string;
  table?: string;
}

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string | null;
  history: QueryHistoryEntry[];

  createTab: (title?: string, opts?: { editorVisible?: boolean; database?: string; table?: string }) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateSql: (tabId: string, sql: string) => void;
  setEditorVisible: (tabId: string, visible: boolean) => void;
  executeQuery: (connectionId: string, tabId: string) => Promise<void>;
  cancelQuery: (connectionId: string, queryId: string) => Promise<void>;
  loadHistory: (connectionId: string) => Promise<void>;
  restoreTabs: (tabs: Array<{ id: string; title: string; sql: string; editorVisible: boolean; database?: string; table?: string }>, activeTabId: string | null) => void;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  history: [],

  createTab: (title, opts) => {
    const id = crypto.randomUUID();
    const tab: QueryTab = {
      id,
      title: title ?? `Query ${get().tabs.length + 1}`,
      sql: '',
      result: null,
      isExecuting: false,
      error: null,
      editorVisible: opts?.editorVisible ?? true,
      database: opts?.database,
      table: opts?.table,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  closeTab: (id) => {
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id);
      const activeTabId =
        s.activeTabId === id
          ? tabs.length > 0
            ? tabs[tabs.length - 1].id
            : null
          : s.activeTabId;
      return { tabs, activeTabId };
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateSql: (tabId, sql) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, sql } : t)),
    }));
  },

  setEditorVisible: (tabId, visible) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, editorVisible: visible } : t,
      ),
    }));
  },

  executeQuery: async (connectionId, tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.sql.trim()) return;

    const activity = useActivityStore.getState();
    const activityId = activity.logStart(tab.sql);
    const startTime = performance.now();

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, isExecuting: true, error: null, result: null }
          : t,
      ),
    }));

    try {
      const result = await ipc.executeQuery(connectionId, tab.sql);
      const durationMs = Math.round(performance.now() - startTime);
      useActivityStore.getState().logSuccess(activityId, durationMs, result.rows.length);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, isExecuting: false, result } : t,
        ),
      }));
    } catch (e) {
      const durationMs = Math.round(performance.now() - startTime);
      useActivityStore.getState().logError(activityId, durationMs, String(e));
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId
            ? { ...t, isExecuting: false, error: String(e) }
            : t,
        ),
      }));
    }
  },

  cancelQuery: async (connectionId, queryId) => {
    await ipc.cancelQuery(connectionId, queryId);
  },

  loadHistory: async (connectionId) => {
    const history = await ipc.getQueryHistory(connectionId);
    set({ history });
  },

  restoreTabs: (tabs, activeTabId) => {
    const restored: QueryTab[] = tabs.map((t) => ({
      ...t,
      result: null,
      isExecuting: false,
      error: null,
    }));
    set({ tabs: restored, activeTabId });
  },
}));

// Auto-save session on tab changes (debounced)
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;
useQueryStore.subscribe((state) => {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    const connectionId = useConnectionStore.getState().activeConnectionId;
    saveSession(state.tabs, state.activeTabId, connectionId);
  }, 1000);
});
