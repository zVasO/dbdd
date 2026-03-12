import { useMemo, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/uiStore';
import { useImportExportStore } from '@/stores/importExportStore';
import {
  toCSV,
  toJSON,
  toSQLInsert,
  toSQLCreateAndInsert,
  toMarkdown,
} from '@/lib/exportFormats';
import { useQueryStore } from '@/stores/queryStore';
import { useResultStore } from '@/stores/resultStore';
import type { QueryResult } from '@/lib/types';
import {
  Download,
  Loader2,
  FileText,
  FileJson,
  FileSpreadsheet,
  FileCode,
  FileType,
  Table2,
} from 'lucide-react';

const FORMAT_OPTIONS = [
  {
    value: 'csv' as const,
    label: 'CSV',
    description: 'Comma-separated values',
    icon: FileText,
    extension: '.csv',
  },
  {
    value: 'json' as const,
    label: 'JSON',
    description: 'JavaScript Object Notation',
    icon: FileJson,
    extension: '.json',
  },
  {
    value: 'excel' as const,
    label: 'Excel',
    description: 'XLSX spreadsheet',
    icon: FileSpreadsheet,
    extension: '.xlsx',
  },
  {
    value: 'sql-insert' as const,
    label: 'SQL INSERT',
    description: 'INSERT INTO statements',
    icon: FileCode,
    extension: '.sql',
  },
  {
    value: 'sql-create' as const,
    label: 'SQL CREATE + INSERT',
    description: 'CREATE TABLE + INSERT statements',
    icon: FileCode,
    extension: '.sql',
  },
  {
    value: 'markdown' as const,
    label: 'Markdown',
    description: 'Markdown table format',
    icon: FileType,
    extension: '.md',
  },
];

export function ExportDialog() {
  const pushModal = useUIStore((s) => s.pushModal);
  const popModal = useUIStore((s) => s.popModal);
  const exportDialogOpenForModal = useImportExportStore((s) => s.exportDialogOpen);

  // Register modal when open
  useEffect(() => {
    if (exportDialogOpenForModal) {
      pushModal('exportDialog');
      return () => popModal('exportDialog');
    }
  }, [exportDialogOpenForModal, pushModal, popModal]);

  const activeTab = useQueryStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab ?? null;
  });
  const tabResult = useResultStore((s) => activeTab ? s.results[activeTab.id] : undefined);
  const result: QueryResult | null = useMemo(() => {
    if (!tabResult || !activeTab) return null;
    const allResults = useResultStore.getState().getAllResults(activeTab.id);
    return allResults[tabResult.activeResultIndex] ?? null;
  }, [tabResult, activeTab]);
  const tableName = activeTab?.table ?? activeTab?.title ?? 'export';
  const {
    exportDialogOpen,
    setExportDialogOpen,
    exportFormat,
    exportLoading,
    setExportFormat,
    exportResult,
  } = useImportExportStore();

  const preview = useMemo(() => {
    if (!result || result.rows.length === 0) return '';

    // Create a small result for preview (first 5 rows)
    const previewResult: QueryResult = {
      ...result,
      rows: result.rows.slice(0, 5),
      total_rows: Math.min(5, result.rows.length),
    };

    try {
      switch (exportFormat) {
        case 'csv':
          return toCSV(previewResult);
        case 'json':
          return toJSON(previewResult, { pretty: true });
        case 'sql-insert':
          return toSQLInsert(previewResult, tableName);
        case 'sql-create':
          return toSQLCreateAndInsert(previewResult, tableName);
        case 'markdown':
          return toMarkdown(previewResult);
        case 'excel':
          return '[Excel preview not available — binary format]';
        default:
          return '';
      }
    } catch {
      return 'Preview not available';
    }
  }, [result, exportFormat, tableName]);

  const handleExport = useCallback(() => {
    if (!result) return;
    exportResult(result, tableName);
  }, [result, tableName, exportResult]);

  const rowCount = result?.rows.length ?? 0;
  const colCount = result?.columns.length ?? 0;

  return (
    <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Export Data</DialogTitle>
          <DialogDescription>
            Export {rowCount} rows and {colCount} columns to a file.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Format selector */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Format</Label>
            <div className="grid grid-cols-3 gap-2">
              {FORMAT_OPTIONS.map((fmt) => {
                const Icon = fmt.icon;
                const isSelected = exportFormat === fmt.value;
                return (
                  <button
                    key={fmt.value}
                    type="button"
                    onClick={() => setExportFormat(fmt.value)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 rounded-md border p-3 text-sm transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border hover:bg-accent hover:text-accent-foreground'
                    )}
                  >
                    <Icon className="size-5" />
                    <span className="font-medium text-xs">{fmt.label}</span>
                    <span className="text-[10px] text-muted-foreground leading-tight text-center">
                      {fmt.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Info bar */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Table2 className="size-3.5" />
              {tableName}
            </div>
            <span>{rowCount} rows</span>
            <span>{colCount} columns</span>
            <span className="ml-auto">
              {FORMAT_OPTIONS.find((f) => f.value === exportFormat)?.extension}
            </span>
          </div>

          {/* Preview */}
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">
              Preview (first {Math.min(5, rowCount)} rows)
            </Label>
            <div className="rounded-md border bg-muted/30 p-3 max-h-[300px] overflow-y-auto overflow-x-auto">
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {preview || 'No data to preview'}
              </pre>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setExportDialogOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExport}
            disabled={exportLoading || !result || rowCount === 0}
          >
            {exportLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="size-4" />
                Export {FORMAT_OPTIONS.find((f) => f.value === exportFormat)?.extension}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
