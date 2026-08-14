import { create } from 'zustand';
import { ipc, extractErrorMessage } from '@/lib/ipc';
import { toExcel } from '@/lib/exportFormats';
import { runExport } from '@/lib/exportRunner';
import { quoteIdentifier } from '@/lib/sql-utils';
import { showErrorToast } from './toastStore';
import { useConnectionStore } from './connectionStore';
import type { ColumnarSlice, CopyFormat } from '@/lib/columnarFormat';
import type { QueryResult } from '@/lib/types';

type ImportFileType = 'csv' | 'json' | 'sql';
type ExportFormat = 'csv' | 'json' | 'excel' | 'sql-insert' | 'sql-create' | 'markdown';

/**
 * What the export runs on. The text formats read the slice directly, so the
 * dialog never materializes rows; `rowResult` exists only for Excel, whose
 * sheet builder needs row objects, and is called only in that branch.
 */
export interface ExportSource {
  slice: ColumnarSlice;
  rowResult: () => QueryResult | null;
}

const COPY_FORMATS: Record<Exclude<ExportFormat, 'excel'>, CopyFormat> = {
  csv: 'csv',
  json: 'json',
  'sql-insert': 'insert',
  'sql-create': 'create',
  markdown: 'markdown',
};

const MIME_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv',
  json: 'application/json',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'sql-insert': 'text/sql',
  'sql-create': 'text/sql',
  markdown: 'text/markdown',
};

const EXTENSIONS: Record<ExportFormat, string> = {
  csv: '.csv',
  json: '.json',
  excel: '.xlsx',
  'sql-insert': '_insert.sql',
  'sql-create': '_create.sql',
  markdown: '.md',
};

interface ImportExportState {
  importDialogOpen: boolean;
  importFile: { name: string; type: ImportFileType } | null;
  importPreview: { columns: string[]; rows: string[][]; detectedTypes: string[] } | null;
  importAllRows: string[][] | null;
  importTargetTable: string;
  importMode: 'create' | 'insert';
  importLoading: boolean;
  importError: string | null;
  csvSeparator: string;

  exportDialogOpen: boolean;
  exportFormat: ExportFormat;
  exportLoading: boolean;

  setImportDialogOpen: (open: boolean) => void;
  setExportDialogOpen: (open: boolean) => void;
  parseFile: (file: File) => Promise<void>;
  executeImport: (connectionId: string, database: string) => Promise<void>;
  exportResult: (source: ExportSource, tableName: string) => Promise<void>;
  setCsvSeparator: (sep: string) => void;
  setImportMode: (mode: 'create' | 'insert') => void;
  setImportTargetTable: (table: string) => void;
  setExportFormat: (format: string) => void;
  reset: () => void;
}

function detectFileType(fileName: string): ImportFileType {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'json') return 'json';
  if (ext === 'sql') return 'sql';
  return 'csv';
}

function detectColumnType(values: string[]): string {
  let hasInt = true;
  let hasFloat = true;
  let hasBool = true;
  let nonEmpty = 0;

  for (const v of values) {
    if (v === '' || v === null || v === undefined) continue;
    nonEmpty++;
    if (hasBool && v !== 'true' && v !== 'false' && v !== '0' && v !== '1') hasBool = false;
    if (hasInt && !/^-?\d+$/.test(v)) hasInt = false;
    if (hasFloat && !/^-?\d+(\.\d+)?$/.test(v)) hasFloat = false;
  }

  if (nonEmpty === 0) return 'TEXT';
  if (hasBool) return 'BOOLEAN';
  if (hasInt) return 'INTEGER';
  if (hasFloat) return 'FLOAT';
  return 'TEXT';
}

function escapeSQL(val: string, type: string): string {
  if (val === '' || val === null || val === undefined) return 'NULL';
  if (type === 'INTEGER' || type === 'FLOAT') {
    const num = Number(val);
    return isNaN(num) ? 'NULL' : String(num);
  }
  if (type === 'BOOLEAN') {
    return val === 'true' || val === '1' ? 'TRUE' : 'FALSE';
  }
  return `'${val.replace(/'/g, "''")}'`;
}

/**
 * The import target, qualified with the selected database only on MySQL.
 *
 * A MySQL session can write to any database on the server, which is what the
 * `USE` statement this replaces was reaching for — unreliably, since MySQL
 * refuses to prepare `USE` and the statements after it went to whichever
 * database the connection defaults to. Postgres cannot write across databases
 * at all and its table list comes from the current one, so qualifying there
 * would name a schema that doesn't exist; SQLite has no database to pick.
 * Mirrors `qualifying_database` in the native import path.
 */
export function qualifiedTable(table: string, database: string, dbType: string): string {
  const quoted = quoteIdentifier(table, dbType);
  if (dbType !== 'mysql' || !database) return quoted;
  return `${quoteIdentifier(database, dbType)}.${quoted}`;
}

function triggerDownload(content: string | ArrayBuffer, fileName: string, mimeType: string): void {
  let blob: Blob;
  if (content instanceof ArrayBuffer) {
    blob = new Blob([content], { type: mimeType });
  } else {
    blob = new Blob([content], { type: mimeType });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const useImportExportStore = create<ImportExportState>((set, get) => ({
  importDialogOpen: false,
  importFile: null,
  importPreview: null,
  importAllRows: null,
  importTargetTable: '',
  importMode: 'create',
  importLoading: false,
  importError: null,
  csvSeparator: ',',

  exportDialogOpen: false,
  exportFormat: 'csv',
  exportLoading: false,

  setImportDialogOpen: (open) => {
    set({ importDialogOpen: open });
    if (!open) {
      set({
        importFile: null,
        importPreview: null,
        importAllRows: null,
        importTargetTable: '',
        importMode: 'create',
        importError: null,
        importLoading: false,
      });
    }
  },

  setExportDialogOpen: (open) => {
    set({ exportDialogOpen: open });
    if (!open) {
      set({ exportLoading: false });
    }
  },

  parseFile: async (file: File) => {
    const fileType = detectFileType(file.name);
    set({ importFile: { name: file.name, type: fileType }, importError: null, importLoading: true });

    try {
      const text = await file.text();

      if (fileType === 'csv') {
        const { default: Papa } = await import('papaparse');
        const separator = get().csvSeparator;
        const parsed = Papa.parse<string[]>(text, {
          delimiter: separator,
          header: false,
          skipEmptyLines: true,
        });

        if (parsed.errors.length > 0 && parsed.data.length === 0) {
          set({ importError: parsed.errors.map((e) => e.message).join('; '), importLoading: false });
          return;
        }

        const allRows = parsed.data;
        if (allRows.length === 0) {
          set({ importError: 'File is empty', importLoading: false });
          return;
        }

        const columns = allRows[0];
        const dataRows = allRows.slice(1);
        const detectedTypes = columns.map((_, colIndex) => {
          const sampleValues = dataRows.slice(0, 100).map((row) => row[colIndex] ?? '');
          return detectColumnType(sampleValues);
        });

        // Store all rows for import, but only show 100 in preview
        const fullRows = dataRows.map((row) =>
          columns.map((_, i) => row[i] ?? '')
        );
        const previewRows = fullRows.slice(0, 100);

        const tableName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        set({
          importPreview: { columns, rows: previewRows, detectedTypes },
          importAllRows: fullRows,
          importTargetTable: tableName,
          importLoading: false,
        });
      } else if (fileType === 'json') {
        const data = JSON.parse(text);
        let rows: Record<string, unknown>[];

        if (Array.isArray(data)) {
          rows = data;
        } else if (typeof data === 'object' && data !== null) {
          // Try to find an array in the first key
          const firstArrayKey = Object.keys(data).find((k) => Array.isArray(data[k]));
          if (firstArrayKey) {
            rows = data[firstArrayKey];
          } else {
            rows = [data];
          }
        } else {
          set({ importError: 'JSON must be an array of objects', importLoading: false });
          return;
        }

        if (rows.length === 0) {
          set({ importError: 'No rows found in JSON', importLoading: false });
          return;
        }

        // Extract columns from all rows' keys
        const columnSet = new Set<string>();
        for (const row of rows.slice(0, 1000)) {
          if (typeof row === 'object' && row !== null) {
            for (const key of Object.keys(row)) {
              columnSet.add(key);
            }
          }
        }
        const columns = Array.from(columnSet);

        const fullRows = rows.map((row) =>
          columns.map((col) => {
            const val = (row as Record<string, unknown>)[col];
            if (val === null || val === undefined) return '';
            if (typeof val === 'object') return JSON.stringify(val);
            return String(val);
          })
        );

        const previewRows = fullRows.slice(0, 100);
        const detectedTypes = columns.map((_, colIndex) => {
          const sampleValues = previewRows.map((row) => row[colIndex]);
          return detectColumnType(sampleValues);
        });

        const tableName = file.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_]/g, '_');
        set({
          importPreview: { columns, rows: previewRows, detectedTypes },
          importAllRows: fullRows,
          importTargetTable: tableName,
          importLoading: false,
        });
      } else {
        // SQL file — just store the raw SQL, no preview needed
        set({
          importPreview: { columns: ['SQL'], rows: [[text.slice(0, 5000)]], detectedTypes: ['TEXT'] },
          importTargetTable: '',
          importLoading: false,
        });
      }
    } catch (err) {
      const errMsg = extractErrorMessage(err);
      showErrorToast(errMsg);
      set({ importError: errMsg, importLoading: false });
    }
  },

  executeImport: async (connectionId: string, database: string) => {
    const { importPreview, importTargetTable, importMode, importFile } = get();
    if (!importPreview || !importFile) return;

    set({ importLoading: true, importError: null });

    try {
      if (importFile.type === 'sql') {
        // For SQL files, execute the raw SQL directly
        const rawSql = importPreview.rows[0]?.[0] ?? '';
        if (!rawSql.trim()) {
          set({ importError: 'SQL file is empty', importLoading: false });
          return;
        }
        const statements = rawSql
          .split(/;\s*/)
          .map((s) => s.trim())
          .filter(Boolean);
        await ipc.executeBatch(connectionId, statements);
        set({ importLoading: false, importDialogOpen: false });
        return;
      }

      const { columns, detectedTypes } = importPreview;
      const allRows = get().importAllRows ?? importPreview.rows;
      const tableName = importTargetTable || 'imported_data';
      const statements: string[] = [];
      const dbType = useConnectionStore
        .getState()
        .activeConnections.find((c) => c.connectionId === connectionId)?.config.db_type ?? '';
      const target = qualifiedTable(tableName, database, dbType);

      // Create table if mode is "create"
      if (importMode === 'create') {
        const colDefs = columns.map((col, i) => {
          const sqlType = detectedTypes[i] === 'INTEGER'
            ? 'INT'
            : detectedTypes[i] === 'FLOAT'
              ? 'DOUBLE'
              : detectedTypes[i] === 'BOOLEAN'
                ? 'BOOLEAN'
                : 'TEXT';
          return `${quoteIdentifier(col, dbType)} ${sqlType}`;
        });
        statements.push(`CREATE TABLE IF NOT EXISTS ${target} (\n  ${colDefs.join(',\n  ')}\n)`);
      }

      const colNames = columns.map((c) => quoteIdentifier(c, dbType)).join(', ');
      const BATCH_SIZE = 50;

      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE);
        const valuesList = batch.map((row) => {
          const vals = columns.map((_, ci) => escapeSQL(row[ci], detectedTypes[ci]));
          return `(${vals.join(', ')})`;
        });
        statements.push(
          `INSERT INTO ${target} (${colNames}) VALUES\n${valuesList.join(',\n')}`
        );
      }

      // Summary rather than executeBatch: the import only ever needs the
      // counts, and a large file is thousands of statements whose full result
      // envelopes would cross IPC for nothing.
      const summary = await ipc.executeBatchSummary(connectionId, statements);

      if (summary.failed > 0) {
        const errors = summary.outcomes
          .map((o) => o.error)
          .filter((e): e is string => e !== null);
        showErrorToast(errors[0]);
        set({
          importError: `${summary.failed} of ${statements.length} statements failed (${summary.total_affected} rows imported):\n${errors.join('\n')}`,
          importLoading: false,
        });
      } else {
        set({ importLoading: false, importDialogOpen: false });
      }
    } catch (err) {
      const errMsg = extractErrorMessage(err);
      showErrorToast(errMsg);
      set({ importError: errMsg, importLoading: false });
    }
  },

  exportResult: async (source: ExportSource, tableName: string) => {
    const { exportFormat } = get();
    set({ exportLoading: true });

    try {
      const safeName = tableName || 'export';

      if (exportFormat === 'excel') {
        // Excel: dynamic import, runs on main thread (xlsx needs DOM-like env)
        const rows = source.rowResult();
        if (!rows) {
          set({ exportLoading: false });
          return;
        }
        const buffer = await toExcel(rows);
        triggerDownload(buffer, `${safeName}${EXTENSIONS.excel}`, MIME_TYPES.excel);
        set({ exportLoading: false, exportDialogOpen: false });
        return;
      }

      const content = await runExport(source.slice, COPY_FORMATS[exportFormat], {
        tableName: safeName,
        pretty: true,
      });
      triggerDownload(content, `${safeName}${EXTENSIONS[exportFormat]}`, MIME_TYPES[exportFormat]);
      set({ exportLoading: false, exportDialogOpen: false });
    } catch (err) {
      showErrorToast(extractErrorMessage(err));
      set({ exportLoading: false });
    }
  },

  setCsvSeparator: (sep) => set({ csvSeparator: sep }),
  setImportMode: (mode) => set({ importMode: mode }),
  setImportTargetTable: (table) => set({ importTargetTable: table }),
  setExportFormat: (format) => set({ exportFormat: format as ExportFormat }),

  reset: () =>
    set({
      importDialogOpen: false,
      importFile: null,
      importPreview: null,
      importAllRows: null,
      importTargetTable: '',
      importMode: 'create',
      importLoading: false,
      importError: null,
      csvSeparator: ',',
      exportDialogOpen: false,
      exportFormat: 'csv',
      exportLoading: false,
    }),
}));
