import { create } from 'zustand';

export interface ActivityEntry {
  id: string;
  connectionId: string | null;
  sql: string;
  timestamp: Date;
  durationMs: number | null;
  status: 'running' | 'success' | 'error';
  rowCount: number | null;
  error: string | null;
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
    };

    set((state) => ({
      entries: [entry, ...state.entries].slice(0, MAX_ENTRIES),
    }));

    return id;
  },

  logSuccess: (id: string, durationMs: number, rowCount: number | null) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1) return state;
      const entries = [...state.entries];
      entries[idx] = { ...entries[idx], status: 'success' as const, durationMs, rowCount };
      return { entries };
    });
  },

  logError: (id: string, durationMs: number, error: string) => {
    set((state) => {
      const idx = state.entries.findIndex((e) => e.id === id);
      if (idx === -1) return state;
      const entries = [...state.entries];
      entries[idx] = { ...entries[idx], status: 'error' as const, durationMs, error };
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
