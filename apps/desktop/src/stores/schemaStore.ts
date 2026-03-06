import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import type { DatabaseInfo, TableInfo, TableStructure, TableRef } from '../lib/types';

interface SchemaState {
  databases: DatabaseInfo[];
  tables: Record<string, TableInfo[]>;
  structures: Record<string, TableStructure>;
  selectedTable: TableStructure | null;
  loading: boolean;
  structureLoading: Record<string, boolean>;
  /** The currently focused database within the active connection */
  activeDatabase: string | null;

  loadDatabases: (connectionId: string) => Promise<void>;
  loadTables: (connectionId: string, database: string, schema?: string) => Promise<void>;
  loadTableStructure: (connectionId: string, tableRef: TableRef) => Promise<void>;
  setActiveDatabase: (database: string | null) => void;
  /** Clear all cached schema data (used on connection switch) */
  reset: () => void;
}

function structureKey(db: string, table: string): string {
  return `${db}.${table}`;
}

export const useSchemaStore = create<SchemaState>((set, get) => ({
  databases: [],
  tables: {},
  structures: {},
  selectedTable: null,
  loading: false,
  structureLoading: {},
  activeDatabase: null,

  loadDatabases: async (connectionId) => {
    set({ loading: true });
    try {
      const databases = await ipc.listDatabases(connectionId);
      set({ databases, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  loadTables: async (connectionId, database, schema) => {
    set({ loading: true });
    try {
      const tables = await ipc.listTables(connectionId, database, schema);
      set((s) => ({
        tables: { ...s.tables, [database]: tables },
        loading: false,
      }));

      // Preload table structures in background for autocomplete
      for (const table of tables) {
        const key = structureKey(database, table.name);
        if (!get().structures[key]) {
          ipc.getTableStructure(connectionId, {
            database,
            schema: schema ?? null,
            table: table.name,
          }).then((structure) => {
            set((s) => ({
              structures: { ...s.structures, [key]: structure },
            }));
          }).catch(() => {
            // Silently ignore — structure just won't be cached
          });
        }
      }
    } catch {
      set({ loading: false });
    }
  },

  loadTableStructure: async (connectionId, tableRef) => {
    const key = structureKey(tableRef.database ?? '', tableRef.table);

    // Return cached if available
    if (get().structures[key]) {
      set({ selectedTable: get().structures[key] });
      return;
    }

    set((s) => ({ structureLoading: { ...s.structureLoading, [key]: true } }));
    try {
      const structure = await ipc.getTableStructure(connectionId, tableRef);
      set((s) => ({
        selectedTable: structure,
        structures: { ...s.structures, [key]: structure },
        structureLoading: { ...s.structureLoading, [key]: false },
      }));
    } catch {
      set((s) => ({ structureLoading: { ...s.structureLoading, [key]: false } }));
    }
  },

  setActiveDatabase: (database) => {
    set({ activeDatabase: database });
  },

  reset: () => {
    set({
      databases: [],
      tables: {},
      structures: {},
      selectedTable: null,
      loading: false,
      structureLoading: {},
      activeDatabase: null,
    });
  },
}));
