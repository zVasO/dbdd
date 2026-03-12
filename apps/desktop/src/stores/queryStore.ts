import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import { useActivityStore } from './activityStore';
import { useConnectionStore } from './connectionStore';
import { useResultStore } from './resultStore';
import { saveSession } from '../lib/sessionRecovery';
import type { QueryResult, QueryHistoryEntry, ColumnarResult } from '../lib/types';

export type TabViewMode = 'data' | 'structure' | 'er-diagram' | 'dashboard' | 'explain' | 'diff' | 'health' | 'query-builder' | 'migration' | 'alerts' | 'table-designer' | 'processes';

export interface QueryTab {
  id: string;
  connectionId: string | null;
  title: string;
  sql: string;
  isExecuting: boolean;
  error: string | null;
  editorVisible: boolean;
  viewMode: TabViewMode;
  database?: string;
  table?: string;
}

interface QueryState {
  /** All tabs across all connections */
  allTabs: QueryTab[];
  /** Active tab id per connection (connectionId -> tabId) */
  activeTabIds: Record<string, string>;
  history: QueryHistoryEntry[];

  // --- Computed-like helpers (use these in components) ---

  /** Tabs visible for the current active connection */
  tabs: QueryTab[];
  activeTabId: string | null;

  // --- Actions ---

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
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  restoreTabs: (tabs: Array<{ id: string; title: string; sql: string; editorVisible: boolean; connectionId?: string | null; database?: string; table?: string }>, activeTabIds?: Record<string, string>) => void;

  /** Called internally when active connection changes — recomputes visible tabs */
  _syncVisibleTabs: () => void;
}

function getActiveConnectionId(): string | null {
  return useConnectionStore.getState().activeConnectionId;
}

function computeVisibleTabs(allTabs: QueryTab[], connId: string | null): QueryTab[] {
  if (!connId) return allTabs.filter((t) => !t.connectionId);
  return allTabs.filter((t) => t.connectionId === connId || !t.connectionId);
}

export const useQueryStore = create<QueryState>((set, get) => ({
  allTabs: [],
  activeTabIds: {},
  history: [],

  // Computed
  tabs: [],
  activeTabId: null,

  _syncVisibleTabs: () => {
    const connId = getActiveConnectionId();
    const { allTabs, activeTabIds } = get();
    const tabs = computeVisibleTabs(allTabs, connId);
    const activeTabId = (connId && activeTabIds[connId]) || null;
    // If activeTabId doesn't exist in visible tabs, pick the last one
    const validActive = tabs.find((t) => t.id === activeTabId) ? activeTabId : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
    set({ tabs, activeTabId: validActive });
  },

  createTab: (title, opts) => {
    const connId = getActiveConnectionId();
    const id = crypto.randomUUID();
    const { allTabs } = get();
    const connectionTabs = computeVisibleTabs(allTabs, connId);
    const tab: QueryTab = {
      id,
      connectionId: connId,
      title: title ?? `Query ${connectionTabs.length + 1}`,
      sql: '',
      isExecuting: false,
      error: null,
      editorVisible: opts?.editorVisible ?? true,
      viewMode: 'data',
      database: opts?.database,
      table: opts?.table,
    };
    const newAllTabs = [...allTabs, tab];
    const newActiveTabIds = connId
      ? { ...get().activeTabIds, [connId]: id }
      : get().activeTabIds;
    set({ allTabs: newAllTabs, activeTabIds: newActiveTabIds });
    get()._syncVisibleTabs();
    return id;
  },

  closeTab: (id) => {
    const connId = getActiveConnectionId();
    const { allTabs, activeTabIds } = get();
    const newAllTabs = allTabs.filter((t) => t.id !== id);
    const visibleAfterClose = computeVisibleTabs(newAllTabs, connId);
    const currentActiveId = connId ? activeTabIds[connId] : null;
    let newActiveId = currentActiveId;
    if (currentActiveId === id) {
      newActiveId = visibleAfterClose.length > 0 ? visibleAfterClose[visibleAfterClose.length - 1].id : null;
    }
    const newActiveTabIds = connId
      ? { ...activeTabIds, [connId]: newActiveId ?? '' }
      : activeTabIds;
    set({ allTabs: newAllTabs, activeTabIds: newActiveTabIds });
    useResultStore.getState().clearResult(id);
    get()._syncVisibleTabs();
  },

  setActiveTab: (id) => {
    const connId = getActiveConnectionId();
    if (connId) {
      set((s) => ({ activeTabIds: { ...s.activeTabIds, [connId]: id } }));
    }
    get()._syncVisibleTabs();
  },

  updateSql: (tabId, sql) => {
    set((s) => {
      // Only update the sql field — no need to recompute tabs/activeTabId
      // since tab identity and visibility don't change on sql edits
      const allTabs = s.allTabs.map((t) => (t.id === tabId ? { ...t, sql } : t));
      const tabs = s.tabs.map((t) => (t.id === tabId ? { ...t, sql } : t));
      return { allTabs, tabs };
    });
  },

  setEditorVisible: (tabId, visible) => {
    const connId = getActiveConnectionId();
    set((s) => {
      const allTabs = s.allTabs.map((t) =>
        t.id === tabId ? { ...t, editorVisible: visible } : t,
      );
      const tabs = computeVisibleTabs(allTabs, connId);
      const activeTabId = (connId && s.activeTabIds[connId]) || null;
      const validActive = tabs.find((t) => t.id === activeTabId) ? activeTabId : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
      return { allTabs, tabs, activeTabId: validActive };
    });
  },

  setViewMode: (tabId, mode) => {
    const connId = getActiveConnectionId();
    set((s) => {
      const allTabs = s.allTabs.map((t) =>
        t.id === tabId ? { ...t, viewMode: mode } : t,
      );
      const tabs = computeVisibleTabs(allTabs, connId);
      const activeTabId = (connId && s.activeTabIds[connId]) || null;
      const validActive = tabs.find((t) => t.id === activeTabId) ? activeTabId : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
      return { allTabs, tabs, activeTabId: validActive };
    });
  },

  setActiveResult: (tabId, index) => {
    useResultStore.getState().setActiveResultIndex(tabId, index);
  },

  executeQuery: async (connectionId, tabId) => {
    const tab = get().allTabs.find((t) => t.id === tabId);
    if (!tab || !tab.sql.trim()) return;

    const activity = useActivityStore.getState();
    const activityId = activity.logStart(tab.sql, connectionId);
    const startTime = performance.now();

    useResultStore.getState().setExecuting(tabId);

    set((s) => {
      const connId = getActiveConnectionId();
      const allTabs = s.allTabs.map((t) =>
        t.id === tabId
          ? { ...t, isExecuting: true, error: null }
          : t,
      );
      const tabs = computeVisibleTabs(allTabs, connId);
      const activeTabId = (connId && s.activeTabIds[connId]) || null;
      const validActive = tabs.find((t) => t.id === activeTabId) ? activeTabId : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
      return { allTabs, tabs, activeTabId: validActive };
    });

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
        useResultStore.getState().setResults(tabId, results, errors.length > 0 ? errors.join('\n') : null);

        set((s) => {
          const connId = getActiveConnectionId();
          const allTabs = s.allTabs.map((t) =>
            t.id === tabId
              ? { ...t, isExecuting: false, error: errors.length > 0 ? errors.join('\n') : null }
              : t,
          );
          const tabs = computeVisibleTabs(allTabs, connId);
          const activeTabId = (connId && s.activeTabIds[connId]) || null;
          const validActive = tabs.find((t) => t.id === activeTabId) ? activeTabId : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
          return { allTabs, tabs, activeTabId: validActive };
        });
      } else {
        const result = await ipc.executeQueryColumnar(connectionId, tab.sql);
        const durationMs = Math.round(performance.now() - startTime);
        useActivityStore.getState().logSuccess(activityId, durationMs, result.row_count);
        useResultStore.getState().setColumnarResult(tabId, result);

        set((s) => {
          const connId = getActiveConnectionId();
          const allTabs = s.allTabs.map((t) =>
            t.id === tabId ? { ...t, isExecuting: false } : t,
          );
          const tabs = computeVisibleTabs(allTabs, connId);
          const activeTabId = (connId && s.activeTabIds[connId]) || null;
          const validActive = tabs.find((t) => t.id === activeTabId) ? activeTabId : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
          return { allTabs, tabs, activeTabId: validActive };
        });
      }
    } catch (e) {
      const durationMs = Math.round(performance.now() - startTime);
      useActivityStore.getState().logError(activityId, durationMs, String(e));
      useResultStore.getState().setError(tabId, String(e));

      set((s) => {
        const connId = getActiveConnectionId();
        const allTabs = s.allTabs.map((t) =>
          t.id === tabId
            ? { ...t, isExecuting: false, error: String(e) }
            : t,
        );
        const tabs = computeVisibleTabs(allTabs, connId);
        const activeTabId = (connId && s.activeTabIds[connId]) || null;
        const validActive = tabs.find((t) => t.id === activeTabId) ? activeTabId : (tabs.length > 0 ? tabs[tabs.length - 1].id : null);
        return { allTabs, tabs, activeTabId: validActive };
      });
    }
  },

  cancelQuery: async (connectionId, queryId) => {
    await ipc.cancelQuery(connectionId, queryId);
  },

  loadHistory: async (connectionId) => {
    const history = await ipc.getQueryHistory(connectionId);
    set({ history });
  },

  reorderTabs: (fromIndex: number, toIndex: number) => {
    const connectionId = useConnectionStore.getState().activeConnectionId;
    if (!connectionId) return;

    const allTabs = get().allTabs;
    const connectionTabs = allTabs.filter((t) => t.connectionId === connectionId);
    const otherTabs = allTabs.filter((t) => t.connectionId !== connectionId);

    const reordered = [...connectionTabs];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    set({ allTabs: [...otherTabs, ...reordered] });
    get()._syncVisibleTabs();
  },

  restoreTabs: (tabs, activeTabIds) => {
    const restored: QueryTab[] = tabs.map((t) => ({
      ...t,
      connectionId: t.connectionId ?? null,
      isExecuting: false,
      error: null,
      viewMode: 'data' as TabViewMode,
    }));
    set({ allTabs: restored, activeTabIds: activeTabIds ?? {} });
    get()._syncVisibleTabs();
  },
}));

// Sync visible tabs whenever connection changes
useConnectionStore.subscribe((state, prevState) => {
  if (state.activeConnectionId !== prevState.activeConnectionId) {
    useQueryStore.getState()._syncVisibleTabs();
  }
});

// Auto-save session on tab changes (debounced)
// Uses a reference-equality check on allTabs first to avoid
// expensive JSON.stringify on every keystroke
let _saveTimeout: ReturnType<typeof setTimeout> | null = null;
let _lastTabsRef: QueryTab[] | null = null;
let _lastTabSnapshot = '';
useQueryStore.subscribe((state) => {
  // Fast path: if allTabs reference hasn't changed, skip entirely
  if (state.allTabs === _lastTabsRef) return;
  _lastTabsRef = state.allTabs;

  // Debounce first, then snapshot — avoids JSON.stringify on every mutation
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    const snapshot = JSON.stringify(
      state.allTabs.map((t) => [t.id, t.connectionId, t.title, t.sql, t.editorVisible, t.database, t.table]),
    );
    if (snapshot === _lastTabSnapshot) return;
    _lastTabSnapshot = snapshot;
    saveSession(state.allTabs, state.activeTabIds);
  }, 1000);
});
