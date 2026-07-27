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
  /** Background-load column metadata for all tables of a database so columns
      become searchable in the sidebar without expanding each table first. */
  prefetchStructures: (connectionId: string, database: string) => Promise<void>;
  setActiveDatabase: (database: string | null) => void;
  /** Clear all cached schema data (used on connection switch) */
  reset: () => void;
}

function structureKey(db: string, table: string): string {
  return `${db}.${table}`;
}

const PREFETCH_BATCH = 4;
const PREFETCH_CAP = 500;
const PREFETCH_FLUSH_SIZE = 40;

let _loadGeneration = 0;
let _selectedStructureKey: string | null = null;
let _prefetchToken = 0;

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
      // Populate the column index in the background (non-blocking).
      void get().prefetchStructures(connectionId, database);
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

  prefetchStructures: async (connectionId, database) => {
    const token = ++_prefetchToken;
    const tables = get().tables[database] ?? [];
    const pending = tables
      .filter((t) => !get().structures[structureKey(database, t.name)])
      .slice(0, PREFETCH_CAP);

    // Accumulate across batches and flush to the store in large chunks: every
    // `set` re-renders schema subscribers (the sidebar), so writing once per
    // batch would churn the main thread and make typing feel laggy. Never
    // touch selectedTable — this must not hijack the user's selection.
    let acc: Record<string, TableStructure> = {};
    const flush = () => {
      if (Object.keys(acc).length === 0) return;
      const batch = acc;
      acc = {};
      set((s) => ({ structures: { ...s.structures, ...batch } }));
    };

    for (let i = 0; i < pending.length; i += PREFETCH_BATCH) {
      if (token !== _prefetchToken) return; // superseded by a newer prefetch
      const batch = pending.slice(i, i + PREFETCH_BATCH);
      const loaded = await Promise.all(
        batch.map((t) =>
          ipc
            .getTableStructure(connectionId, { database, schema: null, table: t.name })
            .then((structure) => ({ key: structureKey(database, t.name), structure }))
            .catch(() => null),
        ),
      );
      if (token !== _prefetchToken) return;
      for (const r of loaded) {
        if (r) acc[r.key] = r.structure;
      }
      if (Object.keys(acc).length >= PREFETCH_FLUSH_SIZE) flush();
    }
    flush();
  },

  setActiveDatabase: (database) => {
    set({ activeDatabase: database });
  },

  reset: () => {
    _loadGeneration++;
    _prefetchToken++; // abort any in-flight background prefetch
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

// Sync schema data to the fuzzy search worker. Debounced so that rapid schema
// changes (e.g. background prefetch loading many structures) coalesce into a
// single index rebuild instead of rebuilding the whole column list on the main
// thread for every batch.
let _fuzzySyncTimer: ReturnType<typeof setTimeout> | null = null;

useSchemaStore.subscribe((state, prevState) => {
  if (state.tables === prevState.tables && state.structures === prevState.structures) {
    return;
  }
  if (_fuzzySyncTimer) clearTimeout(_fuzzySyncTimer);
  _fuzzySyncTimer = setTimeout(() => {
    _fuzzySyncTimer = null;
    const { tables: tablesByDb, structures } = useSchemaStore.getState();

    const tables: { name: string; database: string }[] = [];
    for (const [db, dbTables] of Object.entries(tablesByDb)) {
      for (const t of dbTables) {
        tables.push({ name: t.name, database: db });
      }
    }

    const columns: { name: string; table: string; type: string }[] = [];
    for (const structure of Object.values(structures)) {
      for (const col of structure.columns) {
        columns.push({
          name: col.name,
          table: structure.table_ref.table,
          type: typeof col.data_type === 'string' ? col.data_type : JSON.stringify(col.data_type),
        });
      }
    }

    getFuzzySearchBridge().syncSchema(tables, columns);
  }, 300);
});
