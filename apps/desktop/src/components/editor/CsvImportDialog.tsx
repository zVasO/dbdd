import { useState, useCallback, useMemo } from 'react';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { ipc } from '@/lib/ipc';
import type { CsvPreview } from '@/lib/types';
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

/** Errors listed before the rest are folded into a count. */
const MAX_LISTED_ERRORS = 5;

function rowCountLabel(csv: CsvPreview): string {
  if (csv.total_rows_estimate === null) return 'size unknown';
  const count = csv.total_rows_estimate.toLocaleString();
  return csv.total_rows_exact ? `${count} rows` : `~${count} rows`;
}

export function CsvImportDialog({ open, onOpenChange }: CsvImportDialogProps) {
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const databases = useSchemaStore((s) => s.databases);
  const tables = useSchemaStore((s) => s.tables);

  const [csv, setCsv] = useState<CsvPreview | null>(null);
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
    const preview = await ipc.importCsv();
    if (!preview) return;
    setCsv(preview);
    // Auto-map: set each CSV column index to itself (same name)
    const map: Record<number, string> = {};
    preview.headers.forEach((h, i) => {
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

    const columnMapping = csv.headers.map((_, idx) => {
      const targetCol = (columnMap[idx] ?? '').trim();
      return targetCol && targetCol !== '__skip__' ? targetCol : null;
    });

    if (columnMapping.every((targetCol) => targetCol === null)) return;

    setImporting(true);
    setResult(null);

    try {
      const summary = await ipc.importCsvExecute({
        fileToken: csv.file_token,
        connectionId: activeConnectionId,
        database: targetDb || null,
        table: targetTable,
        columnMapping,
        createTable: false,
      });

      const failures = summary.outcomes.flatMap((outcome, i) =>
        outcome.error ? [`Batch ${i + 1}: ${outcome.error}`] : []
      );
      const errors = failures.slice(0, MAX_LISTED_ERRORS);
      if (failures.length > errors.length) {
        errors.push(`…and ${failures.length - errors.length} more.`);
      }
      setResult({ success: summary.total_affected, errors });
    } catch (err) {
      setResult({ success: 0, errors: [String(err)] });
    } finally {
      setImporting(false);
    }
  }, [csv, targetDb, targetTable, activeConnectionId, columnMap]);

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
                {csv.file_name} — {rowCountLabel(csv)}, {csv.headers.length} columns
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
                            {csv.sample[0]?.[idx] ?? ''}
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
                      {csv.sample.slice(0, 5).map((row, ri) => (
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
            // A file token is spent by the import that used it, so a repeat
            // click would find nothing to read: choosing the file again is
            // what starts a second import.
            disabled={!csv || !targetTable || importing || result !== null}
            className="gap-1.5"
          >
            {importing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Import {csv ? `(${rowCountLabel(csv)})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
