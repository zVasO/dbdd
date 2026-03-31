import { create } from 'zustand';
import { ipc, extractErrorMessage } from '../lib/ipc';
import { showErrorToast } from './toastStore';
import { getFuzzySearchBridge } from '../lib/fuzzy-search-bridge';
import type { DatabaseInfo, TableInfo, TableStructure, TableRef } from '../lib/types';

interface SchemaState {
  databases: DatabaseInfo[];
  tables: Record<string, TableInfo[]>;
  structures: Record<string, TableStructure>;
  selectedTable: TableStructure | null;
  loading: boolean;
  structureLoading: Record<string, boolean>;
  /** Last schema load error, if any */
  error: string | null;
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

const BATCH_SIZE = 20;
let _loadGeneration = 0;

export const useSchemaStore = create<SchemaState>((set, get) => ({
  databases: [],
  tables: {},
  structures: {},
  selectedTable: null,
  loading: false,
  structureLoading: {},
  error: null,
  activeDatabase: null,

  loadDatabases: async (connectionId) => {
    set({ loading: true, error: null });
    try {
      const databases = await ipc.listDatabases(connectionId);
      set({ databases, loading: false });
    } catch (e) {
      const msg = extractErrorMessage(e);
      console.warn('[schemaStore] loadDatabases failed', e);
      set({ loading: false, error: msg });
      showErrorToast(msg);
    }
  },

  loadTables: async (connectionId, database, schema) => {
    const generation = ++_loadGeneration;
    set({ loading: true });
    try {
      const tables = await ipc.listTables(connectionId, database, schema);
      if (generation !== _loadGeneration) return;
      set((s) => ({
        tables: { ...s.tables, [database]: tables },
        loading: false,
      }));

      // Preload table structures in batches for autocomplete
      const toLoad = tables.filter((t) => !get().structures[structureKey(database, t.name)]);
      for (let i = 0; i < toLoad.length; i += BATCH_SIZE) {
        if (generation !== _loadGeneration) return;
        const batch = toLoad.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map((t) =>
            ipc.getTableStructure(connectionId, {
              database,
              schema: schema ?? null,
              table: t.name,
            }).then((structure) => ({ key: structureKey(database, t.name), structure })),
          ),
        );
        if (generation !== _loadGeneration) return;
        const newStructures: Record<string, TableStructure> = {};
        for (const result of results) {
          if (result.status === 'fulfilled') {
            newStructures[result.value.key] = result.value.structure;
          }
        }
        if (Object.keys(newStructures).length > 0) {
          set((s) => ({
            structures: { ...s.structures, ...newStructures },
          }));
        }
      }
    } catch (e) {
      const msg = extractErrorMessage(e);
      console.warn('[schemaStore] loadTables failed', e);
      if (generation === _loadGeneration) {
        set({ loading: false, error: msg });
        showErrorToast(msg);
      }
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
    } catch (e) {
      const msg = extractErrorMessage(e);
      console.warn('[schemaStore] loadTableStructure failed', e);
      set((s) => ({ structureLoading: { ...s.structureLoading, [key]: false }, error: msg }));
      showErrorToast(msg);
    }
  },

  setActiveDatabase: (database) => {
    set({ activeDatabase: database });
  },

  reset: () => {
    _loadGeneration++;
    set({
      databases: [],
      tables: {},
      structures: {},
      selectedTable: null,
      loading: false,
      structureLoading: {},
      error: null,
      activeDatabase: null,
    });
  },
}));

// Sync schema data to fuzzy search worker on every change
useSchemaStore.subscribe((state, prevState) => {
  if (state.tables === prevState.tables && state.structures === prevState.structures) {
    return;
  }

  const tables: { name: string; database: string }[] = [];
  for (const [db, dbTables] of Object.entries(state.tables)) {
    for (const t of dbTables) {
      tables.push({ name: t.name, database: db });
    }
  }

  const columns: { name: string; table: string; type: string }[] = [];
  for (const structure of Object.values(state.structures)) {
    for (const col of structure.columns) {
      columns.push({
        name: col.name,
        table: structure.table_ref.table,
        type: typeof col.data_type === 'string' ? col.data_type : JSON.stringify(col.data_type),
      });
    }
  }

  getFuzzySearchBridge().syncSchema(tables, columns);
});
