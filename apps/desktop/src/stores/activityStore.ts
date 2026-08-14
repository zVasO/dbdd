import { create } from 'zustand';
import type { AppEvent } from '../lib/types';

export interface ActivityEntry {
  id: string;
  connectionId: string | null;
  sql: string;
  timestamp: Date;
  durationMs: number | null;
  status: 'running' | 'success' | 'error' | 'cancelled';
  rowCount: number | null;
  error: string | null;
  /** Backend query_id, attached once the caller knows it — links this entry to AppEvents on the bus. */
  queryId: string | null;
  /** Progress text from the latest QueryProgress event, if any. */
  progress: string | null;
}

interface RecentTable {
  connectionId: string;
  table: string;
  timestamp: number;
}

interface ActivityState {
  entries: ActivityEntry[];
  expanded: boolean;
  recentTables: RecentTable[];

  logStart: (sql: string, connectionId?: string | null) => string;
  logSuccess: (id: string, durationMs: number, rowCount: number | null) => void;
  logError: (id: string, durationMs: number, error: string) => void;
  logCancelled: (id: string, durationMs: number) => void;
  /** Links a locally-created entry to the backend's query_id, so bus events can find it. */
  attachQueryId: (id: string, queryId: string) => void;
  /** Bus-driven: QueryCancelled → 'cancelled' status, matched by query_id. */
  updateCancelled: (queryId: string) => void;
  /** Bus-driven: QueryProgress → progress text, matched by query_id. */
  updateProgress: (queryId: string, rowsFetched: number) => void;
  toggleExpanded: () => void;
  clear: () => void;
  /** Get entries filtered to a specific connection (null = all) */
  getEntriesForConnection: (connectionId: string | null) => ActivityEntry[];
  /** Track a table being opened */
  trackTableOpen: (connectionId: string, table: string) => void;
  /** Get recently opened tables for a connection */
  getRecentTables: (connectionId: string) => string[];
}

const MAX_ENTRIES = 200;

export const useActivityStore = create<ActivityState>((set, get) => ({
  entries: [],
  expanded: false,
  recentTables: [],

  logStart: (sql: string, connectionId?: string | null): string => {
    const id = crypto.randomUUID();
    const entry: ActivityEntry = {
      id,
      connectionId: connectionId ?? null,
      sql,
      timestamp: new Date(),
      durationMs: null,
      status: 'running',
      rowCount: null,
      error: null,
      queryId: null,
      progress: null,
    };

    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
    }));

    return id;
  },

  logSuccess: (id: string, durationMs: number, rowCount: number | null) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1 || state.entries[idx].status === 'cancelled') return state;
      const entries = [...state.entries];
      entries[idx] = { ...entries[idx], status: 'success' as const, durationMs, rowCount };
      return { entries };
    });
  },

  logError: (id: string, durationMs: number, error: string) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1 || state.entries[idx].status === 'cancelled') return state;
      const entries = [...state.entries];
      entries[idx] = { ...entries[idx], status: 'error' as const, durationMs, error };
      return { entries };
    });
  },

  logCancelled: (id: string, durationMs: number) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1) return state;
      const entries = [...state.entries];
      entries[idx] = { ...entries[idx], status: 'cancelled' as const, durationMs, error: null };
      return { entries };
    });
  },

  attachQueryId: (id: string, queryId: string) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1) return state;
      const entries = [...state.entries];
      entries[idx] = { ...entries[idx], queryId };
      return { entries };
    });
  },

  updateCancelled: (queryId: string) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.queryId === queryId);
      if (idx === -1) return state;
      const entries = [...state.entries];
      const durationMs = Math.round(Date.now() - entries[idx].timestamp.getTime());
      entries[idx] = { ...entries[idx], status: 'cancelled' as const, error: null, durationMs };
      return { entries };
    });
  },

  updateProgress: (queryId: string, rowsFetched: number) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.queryId === queryId);
      if (idx === -1) return state;
      const entries = [...state.entries];
      entries[idx] = { ...entries[idx], progress: `${rowsFetched.toLocaleString()} rows` };
      return { entries };
    });
  },

  toggleExpanded: () => {
    set((state) => ({ expanded: !state.expanded }));
  },

  clear: () => {
    set({ entries: [] });
  },

  getEntriesForConnection: (connectionId: string | null): ActivityEntry[] => {
    if (!connectionId) return get().entries;
    return get().entries.filter((e) => e.connectionId === connectionId);
  },

  trackTableOpen: (connectionId: string, table: string) => {
    set((s) => {
      const filtered = s.recentTables.filter(
        (r) => !(r.connectionId === connectionId && r.table === table)
      );
      const updated = [{ connectionId, table, timestamp: Date.now() }, ...filtered].slice(0, 10);
      return { recentTables: updated };
    });
  },

  getRecentTables: (connectionId: string): string[] => {
    return get().recentTables
      .filter((r) => r.connectionId === connectionId)
      .map((r) => r.table);
  },
}));

/**
 * Dispatches an AppEvent from the backend's `app-event` bus into activityStore.
 * Only QueryCancelled and QueryProgress are wired: started/completed/error
 * entries are already written directly by queryStore, so handling them here
 * too would duplicate rather than update. Everything else is a deliberate no-op.
 */
export function applyAppEvent(event: AppEvent): void {
  switch (event.event_type) {
    case 'QueryCancelled':
      useActivityStore.getState().updateCancelled(event.payload.query_id);
      return;
    case 'QueryProgress':
      useActivityStore.getState().updateProgress(event.payload.query_id, event.payload.rows_fetched);
      return;
    default:
      return;
  }
}
