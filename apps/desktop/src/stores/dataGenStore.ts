import { create } from 'zustand';
import { ipc, extractErrorMessage } from '@/lib/ipc';
import { useSchemaStore } from '@/stores/schemaStore';
import { getProvider, autoDetectProvider } from '@/lib/dataGenProviders';
import { cellValueToJS } from '@/lib/exportFormats';
import Papa from 'papaparse';
import type { QueryResult } from '@/lib/types';

interface DataGenState {
  dialogOpen: boolean;
  selectedDatabase: string | null;
  selectedTable: string | null;
  columnProviders: Record<string, string>;
  rowCount: number;
  generating: boolean;
  error: string | null;

  setDialogOpen: (open: boolean) => void;
  selectTable: (database: string, table: string) => void;
  setProvider: (column: string, providerId: string) => void;
  setRowCount: (count: number) => void;
  generateAndInsert: (connectionId: string) => Promise<void>;
  generateAndExportCSV: () => void;
  getPreviewValues: (providerId: string, count?: number) => (string | number | boolean)[];
}

function escapeGenSQL(val: string | number | boolean | null): string {
  if (val === null) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  return `'${String(val).replace(/'/g, "''")}'`;
}

export const useDataGenStore = create<DataGenState>((set, get) => ({
  dialogOpen: false,
  selectedDatabase: null,
  selectedTable: null,
  columnProviders: {},
  rowCount: 100,
  generating: false,
  error: null,

  setDialogOpen: (open) => {
    set({ dialogOpen: open });
    if (!open) {
      set({
        selectedDatabase: null,
        selectedTable: null,
        columnProviders: {},
        rowCount: 100,
        generating: false,
        error: null,
      });
    }
  },

  selectTable: (database: string, table: string) => {
    const schemaState = useSchemaStore.getState();
    const structureKey = `${database}.${table}`;
    const structure = schemaState.structures[structureKey];

    const columnProviders: Record<string, string> = {};
    if (structure) {
      for (const col of structure.columns) {
        columnProviders[col.name] = autoDetectProvider(col.name, col.data_type);
      }
    }

    set({
      selectedDatabase: database,
      selectedTable: table,
      columnProviders,
      error: null,
    });
  },

  setProvider: (column, providerId) => {
    set((s) => ({
      columnProviders: { ...s.columnProviders, [column]: providerId },
    }));
  },

  setRowCount: (count) => set({ rowCount: count }),

  generateAndInsert: async (connectionId: string) => {
    const { selectedDatabase, selectedTable, columnProviders, rowCount } = get();
    if (!selectedTable || !selectedDatabase) return;

    set({ generating: true, error: null });

    try {
      const columns = Object.keys(columnProviders);
      if (columns.length === 0) {
        set({ error: 'No columns configured', generating: false });
        return;
      }

      const statements: string[] = [];

      // USE database
      if (selectedDatabase) {
        statements.push(`USE \`${selectedDatabase}\``);
      }

      const colNames = columns.map((c) => `\`${c}\``).join(', ');
      const BATCH_SIZE = 50;

      for (let i = 0; i < rowCount; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE, rowCount);
        const valuesList: string[] = [];

        for (let j = i; j < batchEnd; j++) {
          const vals = columns.map((col) => {
            const providerId = columnProviders[col];
            const provider = getProvider(providerId);
            if (!provider) return 'NULL';
            const val = provider.generate();
            return escapeGenSQL(val);
          });
          valuesList.push(`(${vals.join(', ')})`);
        }

        statements.push(
          `INSERT INTO \`${selectedTable}\` (${colNames}) VALUES\n${valuesList.join(',\n')}`
        );
      }

      const results = await ipc.executeBatch(connectionId, statements);
      const errors = results.filter((r) => r.Err).map((r) => r.Err!);

      if (errors.length > 0) {
        set({ error: errors.join('\n'), generating: false });
      } else {
        set({ generating: false, dialogOpen: false });
      }
    } catch (err) {
      set({ error: extractErrorMessage(err), generating: false });
    }
  },

  generateAndExportCSV: () => {
    const { selectedTable, columnProviders, rowCount } = get();
    const columns = Object.keys(columnProviders);
    if (columns.length === 0) return;

    const data: Record<string, string | number | boolean>[] = [];

    for (let i = 0; i < rowCount; i++) {
      const row: Record<string, string | number | boolean> = {};
      for (const col of columns) {
        const providerId = columnProviders[col];
        const provider = getProvider(providerId);
        if (provider) {
          row[col] = provider.generate();
        } else {
          row[col] = '';
        }
      }
      data.push(row);
    }

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTable || 'generated_data'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  getPreviewValues: (providerId: string, count = 5) => {
    const provider = getProvider(providerId);
    if (!provider) return [];
    const values: (string | number | boolean)[] = [];
    for (let i = 0; i < count; i++) {
      values.push(provider.generate());
    }
    return values;
  },
}));
