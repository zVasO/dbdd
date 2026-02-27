import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import type { QueryResult, QueryHistoryEntry } from '../lib/types';

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
}

interface QueryState {
  tabs: QueryTab[];
  activeTabId: string | null;
  history: QueryHistoryEntry[];

  createTab: (title?: string) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateSql: (tabId: string, sql: string) => void;
  executeQuery: (connectionId: string, tabId: string) => Promise<void>;
  cancelQuery: (connectionId: string, queryId: string) => Promise<void>;
  loadHistory: (connectionId: string) => Promise<void>;
}

export const useQueryStore = create<QueryState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  history: [],

  createTab: (title) => {
    const id = crypto.randomUUID();
    const tab: QueryTab = {
      id,
      title: title ?? `Query ${get().tabs.length + 1}`,
      sql: '',
      result: null,
      isExecuting: false,
      error: null,
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

  executeQuery: async (connectionId, tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !tab.sql.trim()) return;

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, isExecuting: true, error: null, result: null }
          : t,
      ),
    }));

    try {
      const result = await ipc.executeQuery(connectionId, tab.sql);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId ? { ...t, isExecuting: false, result } : t,
        ),
      }));
    } catch (e) {
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
}));
