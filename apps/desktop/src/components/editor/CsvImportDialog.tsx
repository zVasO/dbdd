import { useState, useCallback, useMemo } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { ipc } from '@/lib/ipc';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface CsvImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface ParsedCsv {
  headers: string[];
  rows: string[][];
  fileName: string;
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  const delimiter = content.includes('\t') ? '\t' : ',';

  function parseLine(line: string): string[] {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          cells.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    cells.push(current);
    return cells;
  }

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { headers, rows };
}

function escapeValue(val: string): string {
  if (val === '' || val.toLowerCase() === 'null' || val.toLowerCase() === '\\n') return 'NULL';
  const escaped = val.replace(/'/g, "''");
  return `'${escaped}'`;
}

export function CsvImportDialog({ open, onOpenChange }: CsvImportDialogProps) {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const databases = useSchemaStore((s) => s.databases);
  const tables = useSchemaStore((s) => s.tables);

  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [targetDb, setTargetDb] = useState<string>('');
  const [targetTable, setTargetTable] = useState<string>('');
  const [columnMap, setColumnMap] = useState<Record<number, string>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; errors: string[] } | null>(null);

  const dbTables = useMemo(() => {
    if (!targetDb) return [];
    return (tables[targetDb] ?? []).filter((t) => t.table_type === 'Table');
  }, [targetDb, tables]);

  const handlePickFile = useCallback(async () => {
    const file = await ipc.importCsvFile();
    if (!file) return;
    const [name, content] = file;
    const parsed = parseCsv(content);
    setCsv({ headers: parsed.headers, rows: parsed.rows, fileName: name });
    // Auto-map: set each CSV column index to itself (same name)
    const map: Record<number, string> = {};
    parsed.headers.forEach((h, i) => {
      map[i] = h;
    });
    setColumnMap(map);
    setResult(null);
  }, []);

  const handleDbChange = useCallback(async (db: string) => {
    setTargetDb(db);
    setTargetTable('');
    if (activeConnectionId && !tables[db]) {
      await useSchemaStore.getState().loadTables(activeConnectionId, db);
    }
  }, [activeConnectionId, tables]);

  const handleImport = useCallback(async () => {
    if (!csv || !targetTable || !activeConnectionId) return;

    const mappedCols = Object.entries(columnMap)
      .filter(([, targetCol]) => targetCol && targetCol !== '__skip__')
      .map(([csvIdx, targetCol]) => ({ csvIdx: Number(csvIdx), targetCol }));

    if (mappedCols.length === 0) return;

    setImporting(true);
    setResult(null);

    try {
      const colNames = mappedCols.map((m) => `\`${m.targetCol}\``).join(', ');
      const batchSize = 50;
      const statements: string[] = [];

      for (let i = 0; i < csv.rows.length; i += batchSize) {
        const batch = csv.rows.slice(i, i + batchSize);
        const valuesList = batch
          .map((row) => {
            const vals = mappedCols.map((m) => escapeValue(row[m.csvIdx] ?? ''));
            return `(${vals.join(', ')})`;
          })
          .join(',\n');
        statements.push(`INSERT INTO \`${targetTable}\` (${colNames}) VALUES\n${valuesList}`);
      }

      const results = await ipc.executeBatch(activeConnectionId, statements);
      let success = 0;
      const errors: string[] = [];
      results.forEach((r, i) => {
        if (r.Err) {
          errors.push(`Batch ${i + 1}: ${r.Err}`);
        } else {
          success += (r.Ok?.affected_rows ?? 0);
        }
      });
      setResult({ success, errors });
    } catch (err) {
      setResult({ success: 0, errors: [String(err)] });
    } finally {
      setImporting(false);
    }
  }, [csv, targetTable, activeConnectionId, columnMap]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setCsv(null);
    setTargetDb('');
    setTargetTable('');
    setColumnMap({});
    setResult(null);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import CSV</DialogTitle>
          <DialogDescription>
            Import data from a CSV or TSV file into a table.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto flex-1 min-h-0">
          {/* File selection */}
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={handlePickFile} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" />
              Choose File
            </Button>
            {csv && (
              <span className="text-sm text-muted-foreground">
                {csv.fileName} — {csv.rows.length} rows, {csv.headers.length} columns
              </span>
            )}
          </div>

          {csv && (
            <>
              {/* Target selection */}
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Database</label>
                  <Select value={targetDb} onValueChange={handleDbChange}>
                    <SelectTrigger size="sm" className="w-44">
                      <SelectValue placeholder="Select database" />
                    </SelectTrigger>
                    <SelectContent>
                      {databases.map((db) => (
                        <SelectItem key={db.name} value={db.name}>{db.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Table</label>
                  <Select value={targetTable} onValueChange={setTargetTable} disabled={!targetDb}>
                    <SelectTrigger size="sm" className="w-44">
                      <SelectValue placeholder="Select table" />
                    </SelectTrigger>
                    <SelectContent>
                      {dbTables.map((t) => (
                        <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Column mapping */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">Column Mapping</label>
                <div className="rounded border border-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted">
                        <th className="px-2 py-1 text-left font-medium">CSV Column</th>
                        <th className="px-2 py-1 text-left font-medium">Target Column</th>
                        <th className="px-2 py-1 text-left font-medium">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csv.headers.map((header, idx) => (
                        <tr key={idx} className="border-t border-border">
                          <td className="px-2 py-1 font-mono">{header}</td>
                          <td className="px-2 py-1">
                            <input
                              type="text"
                              value={columnMap[idx] ?? ''}
                              onChange={(e) =>
                                setColumnMap((m) => ({ ...m, [idx]: e.target.value }))
                              }
                              placeholder="skip"
                              className="w-full rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                            />
                          </td>
                          <td className="px-2 py-1 text-muted-foreground truncate max-w-[200px]">
                            {csv.rows[0]?.[idx] ?? ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Preview */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium">
                  Data Preview <span className="text-muted-foreground font-normal">(first 5 rows)</span>
                </label>
                <div className="rounded border border-border overflow-auto max-h-32">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted">
                        {csv.headers.map((h, i) => (
                          <th key={i} className="px-2 py-1 text-left font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {csv.rows.slice(0, 5).map((row, ri) => (
                        <tr key={ri} className="border-t border-border">
                          {row.map((cell, ci) => (
                            <td key={ci} className="px-2 py-1 whitespace-nowrap truncate max-w-[150px]">{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Result */}
              {result && (
                <div className={`flex items-start gap-2 rounded border p-3 text-sm ${result.errors.length > 0 ? 'border-destructive/50 bg-destructive/5' : 'border-green-500/50 bg-green-500/5'}`}>
                  {result.errors.length > 0 ? (
                    <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p>{result.success} rows imported successfully.</p>
                    {result.errors.map((err, i) => (
                      <p key={i} className="text-destructive text-xs mt-1">{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            onClick={handleImport}
            disabled={!csv || !targetTable || importing}
            className="gap-1.5"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Import {csv ? `(${csv.rows.length} rows)` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
