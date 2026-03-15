import { create } from 'zustand';
import Papa from 'papaparse';
import { ipc, extractErrorMessage } from '@/lib/ipc';
import { toExcel } from '@/lib/exportFormats';
import type { QueryResult } from '@/lib/types';

type ImportFileType = 'csv' | 'json' | 'sql';
type ExportFormat = 'csv' | 'json' | 'excel' | 'sql-insert' | 'sql-create' | 'markdown';

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
  exportResult: (result: QueryResult, tableName: string) => Promise<void>;
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
      set({ importError: extractErrorMessage(err), importLoading: false });
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
      // TODO: Use quoteIdentifier once dbType is available in import context

      // Use the database
      if (database) {
        statements.push(`USE \`${database}\``);
      }

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
          return `\`${col}\` ${sqlType}`;
        });
        statements.push(`CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n  ${colDefs.join(',\n  ')}\n)`);
      }

      const colNames = columns.map((c) => `\`${c}\``).join(', ');
      const BATCH_SIZE = 50;

      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE);
        const valuesList = batch.map((row) => {
          const vals = columns.map((_, ci) => escapeSQL(row[ci], detectedTypes[ci]));
          return `(${vals.join(', ')})`;
        });
        statements.push(
          `INSERT INTO \`${tableName}\` (${colNames}) VALUES\n${valuesList.join(',\n')}`
        );
      }

      const results = await ipc.executeBatch(connectionId, statements);
      const errors = results
        .filter((r) => r.Err)
        .map((r) => r.Err!);

      if (errors.length > 0) {
        set({ importError: errors.join('\n'), importLoading: false });
      } else {
        set({ importLoading: false, importDialogOpen: false });
      }
    } catch (err) {
      set({ importError: extractErrorMessage(err), importLoading: false });
    }
  },

  exportResult: async (result: QueryResult, tableName: string) => {
    const { exportFormat } = get();
    set({ exportLoading: true });

    try {
      const safeName = tableName || 'export';

      if (exportFormat === 'excel') {
        // Excel: dynamic import, runs on main thread (xlsx needs DOM-like env)
        const buffer = await toExcel(result);
        triggerDownload(buffer, `${safeName}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        set({ exportLoading: false, exportDialogOpen: false });
        return;
      }

      // All other formats: offload to worker
      const worker = new Worker(
        new URL('../workers/export.worker.ts', import.meta.url),
        { type: 'module' },
      );

      const mimeTypes: Record<string, string> = {
        csv: 'text/csv',
        json: 'application/json',
        'sql-insert': 'text/sql',
        'sql-create': 'text/sql',
        markdown: 'text/markdown',
      };
      const extensions: Record<string, string> = {
        csv: '.csv',
        json: '.json',
        'sql-insert': '_insert.sql',
        'sql-create': '_create.sql',
        markdown: '.md',
      };

      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'export-result') {
          triggerDownload(e.data.content, `${safeName}${extensions[exportFormat]}`, mimeTypes[exportFormat]);
          set({ exportLoading: false, exportDialogOpen: false });
        } else if (e.data.type === 'export-error') {
          console.error('Export worker error:', e.data.error);
          set({ exportLoading: false });
        }
        worker.terminate();
      };

      worker.onerror = () => {
        set({ exportLoading: false });
        worker.terminate();
      };

      worker.postMessage({
        type: 'export',
        format: exportFormat,
        columns: result.columns,
        rows: result.rows,
        tableName: safeName,
        options: { pretty: true },
      });
    } catch (err) {
      set({ exportLoading: false });
      throw err;
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
