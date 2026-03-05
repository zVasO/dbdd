import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import { useActivityStore } from './activityStore';
import { useConnectionStore } from './connectionStore';
import { saveSession } from '../lib/sessionRecovery';
import type { QueryResult, QueryHistoryEntry } from '../lib/types';

export type TabViewMode = 'data' | 'structure' | 'er-diagram' | 'dashboard' | 'explain' | 'diff' | 'health' | 'query-builder' | 'migration' | 'alerts' | 'table-designer' | 'processes';

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  results: QueryResult[];
  activeResultIndex: number;
  isExecuting: boolean;
  error: string | null;
  editorVisible: boolean;
  viewMode: TabViewMode;
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
  setViewMode: (tabId: string, mode: TabViewMode) => void;
  setActiveResult: (tabId: string, index: number) => void;
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
      results: [],
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
      editorVisible: opts?.editorVisible ?? true,
      viewMode: 'data',
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

  setViewMode: (tabId, mode) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, viewMode: mode } : t,
      ),
    }));
  },

  setActiveResult: (tabId, index) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const result = t.results[index] ?? null;
        return { ...t, activeResultIndex: index, result };
      }),
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
          ? { ...t, isExecuting: true, error: null, result: null, results: [], activeResultIndex: 0 }
          : t,
      ),
    }));

    // Split into multiple statements for batch execution
    const statements = tab.sql.split(/;\s*/).map((s) => s.trim()).filter(Boolean);
    const isMulti = statements.length > 1;

    try {
      if (isMulti) {
        const batchResults = await ipc.executeBatch(connectionId, statements);
        const durationMs = Math.round(performance.now() - startTime);
        const results: QueryResult[] = [];
        const errors: string[] = [];
        for (const r of batchResults) {
          if (r.Ok) results.push(r.Ok);
          if (r.Err) errors.push(r.Err);
        }
        const totalRows = results.reduce((sum, r) => sum + r.rows.length, 0);
        if (errors.length > 0) {
          useActivityStore.getState().logError(activityId, durationMs, errors.join('; '));
        } else {
          useActivityStore.getState().logSuccess(activityId, durationMs, totalRows);
        }
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId
              ? {
                  ...t,
                  isExecuting: false,
                  results,
                  result: results[0] ?? null,
                  activeResultIndex: 0,
                  error: errors.length > 0 ? errors.join('\n') : null,
                }
              : t,
          ),
        }));
      } else {
        const result = await ipc.executeQuery(connectionId, tab.sql);
        const durationMs = Math.round(performance.now() - startTime);
        useActivityStore.getState().logSuccess(activityId, durationMs, result.rows.length);
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId ? { ...t, isExecuting: false, result, results: [result], activeResultIndex: 0 } : t,
          ),
        }));
      }
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
      results: [],
      activeResultIndex: 0,
      isExecuting: false,
      error: null,
      viewMode: 'data' as TabViewMode,
    }));
    set({ tabs: restored, activeTabId });
  },
}));

// Auto-save session on tab changes (debounced)
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;
useQueryStore.subscribe((state) => {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    const configId = useConnectionStore.getState().activeConfig?.id ?? null;
    saveSession(state.tabs, state.activeTabId, configId);
  }, 1000);
});
