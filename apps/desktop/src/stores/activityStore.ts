import { create } from 'zustand';

export interface ActivityEntry {
  id: string;
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

  logStart: (sql: string) => string;
  logSuccess: (id: string, durationMs: number, rowCount: number | null) => void;
  logError: (id: string, durationMs: number, error: string) => void;
  toggleExpanded: () => void;
  clear: () => void;
}

const MAX_ENTRIES = 200;

export const useActivityStore = create<ActivityState>((set) => ({
  entries: [],
  expanded: false,

  logStart: (sql: string): string => {
    const id = crypto.randomUUID();
    const entry: ActivityEntry = {
      id,
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
}));
