import { create } from 'zustand';
import { ipc, extractErrorMessage } from '../lib/ipc';
import { showErrorToast } from './toastStore';
import { getFuzzySearchBridge } from '../lib/fuzzy-search-bridge';
import type { DatabaseInfo, TableInfo, TableStructure, TableRef, ColumnRef } from '../lib/types';

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
  /** Fetch all column metadata of a database in one query and feed the search
      index — makes columns searchable without loading full table structures. */
  loadAllColumns: (connectionId: string, database: string) => Promise<void>;
  setActiveDatabase: (database: string | null) => void;
  /** Clear all cached schema data (used on connection switch) */
  reset: () => void;
}

function structureKey(db: string, table: string): string {
  return `${db}.${table}`;
}

let _loadGeneration = 0;
let _selectedStructureKey: string | null = null;
/** Bulk column index per database — feeds the fuzzy worker, kept out of the
    reactive store so it never triggers component re-renders. */
let _columnsByDb: Record<string, ColumnRef[]> = {};

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
      // Populate the column search index in the background (non-blocking).
      void get().loadAllColumns(connectionId, database);
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
    _selectedStructureKey = key;

    // Return cached if available
    if (get().structures[key]) {
      set({ selectedTable: get().structures[key] });
      return;
    }

    set((s) => ({ structureLoading: { ...s.structureLoading, [key]: true } }));
    try {
      const structure = await ipc.getTableStructure(connectionId, tableRef);
      // A later selection may have won the race — always cache, but only show
      // this structure if it is still the one the user last asked for.
      set((s) => ({
        ...(key === _selectedStructureKey ? { selectedTable: structure } : {}),
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

  loadAllColumns: async (connectionId, database) => {
    try {
      const columns = await ipc.listAllColumns(connectionId, database);
      _columnsByDb[database] = columns;
      scheduleFuzzySync();
    } catch (e) {
      // Non-fatal: columns just won't be searchable (e.g. SQLite inspector
      // not implemented). Table search still works.
      console.warn('[schemaStore] loadAllColumns failed', e);
    }
  },

  setActiveDatabase: (database) => {
    set({ activeDatabase: database });
  },

  reset: () => {
    _loadGeneration++;
    _columnsByDb = {};
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

// Feed the fuzzy search worker. Debounced so rapid schema changes coalesce into
// one index rebuild. Columns come from the bulk column index (_columnsByDb),
// NOT the reactive structures store, so this neither depends on nor triggers
// component re-renders — which is what previously made typing lag.
let _fuzzySyncTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFuzzySync(): void {
  if (_fuzzySyncTimer) clearTimeout(_fuzzySyncTimer);
  _fuzzySyncTimer = setTimeout(() => {
    _fuzzySyncTimer = null;
    const { tables: tablesByDb } = useSchemaStore.getState();

    const tables: { name: string; database: string }[] = [];
    for (const [db, dbTables] of Object.entries(tablesByDb)) {
      for (const t of dbTables) {
        tables.push({ name: t.name, database: db });
      }
    }

    const columns: { name: string; table: string; type: string }[] = [];
    for (const cols of Object.values(_columnsByDb)) {
      for (const c of cols) {
        columns.push({ name: c.column, table: c.table, type: c.data_type });
      }
    }

    getFuzzySearchBridge().syncSchema(tables, columns);
  }, 300);
}

// Re-sync when the table list changes so table search works immediately, even
// before the column index arrives via loadAllColumns().
useSchemaStore.subscribe((state, prevState) => {
  if (state.tables !== prevState.tables) scheduleFuzzySync();
});
