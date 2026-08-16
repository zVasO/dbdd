import { create } from 'zustand';
import { ipc, extractErrorMessage } from '../lib/ipc';
import { showErrorToast } from './toastStore';
import type { SavedQuery } from '../lib/types';

/** A saved query as the caller supplies it — the store stamps the timestamps. */
export type SavedQueryDraft = Omit<SavedQuery, 'created_at' | 'updated_at'> & {
  created_at?: string;
};

export interface DatabaseGroup {
  database: string | null;
  queries: SavedQuery[];
}

/**
 * Groups by database with the connection-wide (NULL database) queries first,
 * then the named databases alphabetically; queries are sorted by name.
 */
export function groupByDatabase(queries: SavedQuery[]): DatabaseGroup[] {
  const groups = new Map<string | null, SavedQuery[]>();
  for (const q of queries) {
    const key = q.database ?? null;
    const bucket = groups.get(key);
    if (bucket) bucket.push(q);
    else groups.set(key, [q]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === null) return -1;
      if (b === null) return 1;
      return a.localeCompare(b);
    })
    .map(([database, entries]) => ({
      database,
      queries: [...entries].sort((a, b) => a.name.localeCompare(b.name)),
    }));
}

interface SavedQueryState {
  /** Saved queries per connection id */
  byConnection: Record<string, SavedQuery[]>;
  /** Whether the manage/browse dialog is showing */
  manageOpen: boolean;

  load: (connectionId: string) => Promise<void>;
  save: (query: SavedQueryDraft) => Promise<SavedQuery>;
  remove: (id: string, connectionId: string) => Promise<void>;
  setManageOpen: (open: boolean) => void;
}

export const useSavedQueryStore = create<SavedQueryState>((set) => ({
  byConnection: {},
  manageOpen: false,

  load: async (connectionId) => {
    try {
      const queries = await ipc.listSavedQueries(connectionId);
      set((s) => ({ byConnection: { ...s.byConnection, [connectionId]: queries } }));
    } catch (e) {
      console.warn('[savedQueryStore] load failed', e);
      showErrorToast(extractErrorMessage(e));
    }
  },

  save: async (query) => {
    const now = new Date().toISOString();
    const stamped: SavedQuery = {
      ...query,
      created_at: query.created_at ?? now,
      updated_at: now,
    };
    await ipc.saveSavedQuery(stamped);
    set((s) => {
      const slice = s.byConnection[stamped.connection_id] ?? [];
      const exists = slice.some((q) => q.id === stamped.id);
      return {
        byConnection: {
          ...s.byConnection,
          [stamped.connection_id]: exists
            ? slice.map((q) => (q.id === stamped.id ? stamped : q))
            : [...slice, stamped],
        },
      };
    });
    return stamped;
  },

  remove: async (id, connectionId) => {
    await ipc.deleteSavedQuery(id);
    set((s) => {
      const slice = s.byConnection[connectionId];
      if (!slice) return {};
      return {
        byConnection: { ...s.byConnection, [connectionId]: slice.filter((q) => q.id !== id) },
      };
    });
  },

  setManageOpen: (open) => set({ manageOpen: open }),
}));
