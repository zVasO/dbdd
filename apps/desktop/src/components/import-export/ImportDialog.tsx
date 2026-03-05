import { useCallback, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useImportExportStore } from '@/stores/importExportStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSchemaStore } from '@/stores/schemaStore';
import {
  Upload,
  FileUp,
  Table2,
  AlertCircle,
  Loader2,
  CheckCircle2,
  FileText,
  FileJson,
  FileCode,
} from 'lucide-react';

const SEPARATOR_OPTIONS = [
  { value: ',', label: 'Comma (,)' },
  { value: ';', label: 'Semicolon (;)' },
  { value: '\t', label: 'Tab (\\t)' },
  { value: '|', label: 'Pipe (|)' },
];

function FileTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'csv':
      return <FileText className="size-5 text-green-500" />;
    case 'json':
      return <FileJson className="size-5 text-yellow-500" />;
    case 'sql':
      return <FileCode className="size-5 text-blue-500" />;
    default:
      return <FileUp className="size-5" />;
  }
}

export function ImportDialog() {
  const {
    importDialogOpen,
    setImportDialogOpen,
    importFile,
    importPreview,
    importTargetTable,
    importMode,
    importLoading,
    importError,
    csvSeparator,
    parseFile,
    executeImport,
    setCsvSeparator,
    setImportMode,
    setImportTargetTable,
  } = useImportExportStore();

  const { activeConnectionId } = useConnectionStore();
  const { databases, tables } = useSchemaStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [selectedDatabase, setSelectedDatabase] = useState<string>(
    databases[0]?.name ?? ''
  );

  const handleFileSelect = useCallback(
    (file: File) => {
      parseFile(file);
    },
    [parseFile]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const handleExecute = useCallback(() => {
    if (!activeConnectionId) return;
    executeImport(activeConnectionId, selectedDatabase);
  }, [activeConnectionId, selectedDatabase, executeImport]);

  const handleSeparatorChange = useCallback(
    (val: string) => {
      setCsvSeparator(val);
      // Re-parse with new separator if we have a file input
      if (fileInputRef.current?.files?.[0]) {
        parseFile(fileInputRef.current.files[0]);
      }
    },
    [setCsvSeparator, parseFile]
  );

  const existingTables = tables[selectedDatabase] ?? [];

  return (
    <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Import Data</DialogTitle>
          <DialogDescription>
            Import data from CSV, JSON, or SQL files into your database.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Step 1: File Drop Zone */}
          {!importPreview && (
            <div className="space-y-3">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors',
                  dragOver
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-muted-foreground/50'
                )}
              >
                <Upload className="size-10 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium">
                    Drop a file here or click to browse
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Supports .csv, .json, and .sql files
                  </p>
                </div>
                {importLoading && (
                  <Loader2 className="size-5 animate-spin text-primary" />
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,.sql,.tsv,.txt"
                className="hidden"
                onChange={handleInputChange}
              />

              {/* CSV separator option */}
              <div className="flex items-center gap-3">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  CSV Separator:
                </Label>
                <Select value={csvSeparator} onValueChange={handleSeparatorChange}>
                  <SelectTrigger className="w-40" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEPARATOR_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {importPreview && importFile && (
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center gap-2 text-sm">
                <FileTypeIcon type={importFile.type} />
                <span className="font-medium">{importFile.name}</span>
                <Badge variant="secondary" className="text-xs">
                  {importFile.type.toUpperCase()}
                </Badge>
                <span className="text-muted-foreground">
                  {importPreview.rows.length} rows, {importPreview.columns.length} columns
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    useImportExportStore.setState({
                      importFile: null,
                      importPreview: null,
                      importError: null,
                    });
                  }}
                >
                  Change file
                </Button>
              </div>

              {/* Column types */}
              {importFile.type !== 'sql' && (
                <div className="flex flex-wrap gap-1.5">
                  {importPreview.columns.map((col, i) => (
                    <Badge key={col} variant="outline" className="text-xs gap-1">
                      {col}
                      <span className="text-muted-foreground">
                        {importPreview.detectedTypes[i]}
                      </span>
                    </Badge>
                  ))}
                </div>
              )}

              {/* Preview table */}
              {importFile.type !== 'sql' ? (
                <div className="rounded-md border overflow-x-auto max-h-[250px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted">
                      <tr>
                        <th className="px-2 py-1.5 text-left font-medium text-muted-foreground w-8">
                          #
                        </th>
                        {importPreview.columns.map((col) => (
                          <th
                            key={col}
                            className="px-2 py-1.5 text-left font-medium whitespace-nowrap"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.slice(0, 50).map((row, ri) => (
                        <tr key={ri} className="border-t">
                          <td className="px-2 py-1 text-muted-foreground">{ri + 1}</td>
                          {row.map((cell, ci) => (
                            <td
                              key={ci}
                              className="px-2 py-1 max-w-[200px] truncate"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-md border p-3 bg-muted/50 max-h-[250px] overflow-y-auto">
                  <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                    {importPreview.rows[0]?.[0]?.slice(0, 2000)}
                    {(importPreview.rows[0]?.[0]?.length ?? 0) > 2000 && '...'}
                  </pre>
                </div>
              )}

              {/* Step 3: Import configuration */}
              {importFile.type !== 'sql' && (
                <div className="space-y-3 border-t pt-3">
                  <div className="grid grid-cols-2 gap-3">
                    {/* Database selector */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Database</Label>
                      <Select
                        value={selectedDatabase}
                        onValueChange={setSelectedDatabase}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue placeholder="Select database" />
                        </SelectTrigger>
                        <SelectContent>
                          {databases.map((db) => (
                            <SelectItem key={db.name} value={db.name}>
                              {db.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Import mode */}
                    <div className="space-y-1.5">
                      <Label className="text-xs">Mode</Label>
                      <Select
                        value={importMode}
                        onValueChange={(val) => setImportMode(val as 'create' | 'insert')}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="create">Create new table</SelectItem>
                          <SelectItem value="insert">Insert into existing</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Table name */}
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {importMode === 'create' ? 'Table Name' : 'Target Table'}
                    </Label>
                    {importMode === 'create' ? (
                      <Input
                        value={importTargetTable}
                        onChange={(e) => setImportTargetTable(e.target.value)}
                        placeholder="Enter table name"
                        className="h-8 text-sm"
                      />
                    ) : (
                      <Select
                        value={importTargetTable}
                        onValueChange={setImportTargetTable}
                      >
                        <SelectTrigger size="sm">
                          <SelectValue placeholder="Select a table" />
                        </SelectTrigger>
                        <SelectContent>
                          {existingTables.map((t) => (
                            <SelectItem key={t.name} value={t.name}>
                              <div className="flex items-center gap-2">
                                <Table2 className="size-3.5" />
                                {t.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error display */}
          {importError && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <pre className="whitespace-pre-wrap text-xs">{importError}</pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setImportDialogOpen(false)}
          >
            Cancel
          </Button>
          {importPreview && (
            <Button
              onClick={handleExecute}
              disabled={
                importLoading ||
                !activeConnectionId ||
                (importFile?.type !== 'sql' && !importTargetTable)
              }
            >
              {importLoading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  Import
                </>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
