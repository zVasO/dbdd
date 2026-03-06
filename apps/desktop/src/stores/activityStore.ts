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

interface ActivityState {
  entries: ActivityEntry[];
  expanded: boolean;

  logStart: (sql: string, connectionId?: string | null) => string;
  logSuccess: (id: string, durationMs: number, rowCount: number | null) => void;
  logError: (id: string, durationMs: number, error: string) => void;
  toggleExpanded: () => void;
  clear: () => void;
  /** Get entries filtered to a specific connection (null = all) */
  getEntriesForConnection: (connectionId: string | null) => ActivityEntry[];
}

const MAX_ENTRIES = 200;

export const useActivityStore = create<ActivityState>((set, get) => ({
  entries: [],
  expanded: false,

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
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === id
          ? { ...entry, status: 'success' as const, durationMs, rowCount }
          : entry
      ),
    }));
  },

  logError: (id: string, durationMs: number, error: string) => {
    set((state) => ({
      entries: state.entries.map((entry) =>
        entry.id === id
          ? { ...entry, status: 'error' as const, durationMs, error }
          : entry
      ),
    }));
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
}));
