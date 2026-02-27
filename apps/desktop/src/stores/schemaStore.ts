import { create } from 'zustand';
import { ipc } from '../lib/ipc';
import type { DatabaseInfo, TableInfo, TableStructure, TableRef } from '../lib/types';

interface SchemaState {
  databases: DatabaseInfo[];
  tables: Record<string, TableInfo[]>;
  selectedTable: TableStructure | null;
  loading: boolean;

  loadDatabases: (connectionId: string) => Promise<void>;
  loadTables: (connectionId: string, database: string, schema?: string) => Promise<void>;
  loadTableStructure: (connectionId: string, tableRef: TableRef) => Promise<void>;
}

export const useSchemaStore = create<SchemaState>((set) => ({
  databases: [],
  tables: {},
  selectedTable: null,
  loading: false,

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
    } catch {
      set({ loading: false });
    }
  },

  loadTableStructure: async (connectionId, tableRef) => {
    set({ loading: true });
    try {
      const structure = await ipc.getTableStructure(connectionId, tableRef);
      set({ selectedTable: structure, loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));
