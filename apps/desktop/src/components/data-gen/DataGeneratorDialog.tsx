import { useCallback, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useDataGenStore } from '@/stores/dataGenStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { ProviderSelect } from '@/components/data-gen/ProviderSelect';
import {
  Loader2,
  Wand2,
  Download,
  Table2,
  AlertCircle,
  Database,
  RefreshCw,
} from 'lucide-react';

const ROW_COUNT_OPTIONS = [10, 100, 1000, 10000, 100000];

export function DataGeneratorDialog() {
  const {
    dialogOpen,
    setDialogOpen,
    selectedDatabase,
    selectedTable,
    columnProviders,
    rowCount,
    generating,
    error,
    selectTable,
    setProvider,
    setRowCount,
    generateAndInsert,
    generateAndExportCSV,
    getPreviewValues,
  } = useDataGenStore();

  const { activeConnectionId } = useConnectionStore();
  const { databases, tables, structures } = useSchemaStore();

  const [previewKey, setPreviewKey] = useState(0);

  const structureKey = selectedDatabase && selectedTable
    ? `${selectedDatabase}.${selectedTable}`
    : null;
  const structure = structureKey ? structures[structureKey] : null;
  const columns = structure?.columns ?? [];

  const databaseList = databases;
  const tableList = selectedDatabase ? (tables[selectedDatabase] ?? []) : [];

  const handleDatabaseChange = useCallback(
    (db: string) => {
      useDataGenStore.setState({
        selectedDatabase: db,
        selectedTable: null,
        columnProviders: {},
      });
    },
    []
  );

  const handleTableChange = useCallback(
    (table: string) => {
      if (!selectedDatabase) return;
      selectTable(selectedDatabase, table);
    },
    [selectedDatabase, selectTable]
  );

  const handleGenInsert = useCallback(() => {
    if (!activeConnectionId) return;
    generateAndInsert(activeConnectionId);
  }, [activeConnectionId, generateAndInsert]);

  const handleRefreshPreview = useCallback(() => {
    setPreviewKey((k) => k + 1);
  }, []);

  return (
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="size-5" />
            Data Generator
          </DialogTitle>
          <DialogDescription>
            Generate realistic mock data and insert it into a table or export as CSV.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {/* Database + Table selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Database className="size-3" />
                Database
              </Label>
              <Select
                value={selectedDatabase ?? ''}
                onValueChange={handleDatabaseChange}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder="Select database" />
                </SelectTrigger>
                <SelectContent>
                  {databaseList.map((db) => (
                    <SelectItem key={db.name} value={db.name}>
                      {db.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                <Table2 className="size-3" />
                Table
              </Label>
              <Select
                value={selectedTable ?? ''}
                onValueChange={handleTableChange}
                disabled={!selectedDatabase}
              >
                <SelectTrigger size="sm">
                  <SelectValue placeholder="Select table" />
                </SelectTrigger>
                <SelectContent>
                  {tableList
                    .filter((t) => t.table_type === 'Table')
                    .map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Column mapping */}
          {columns.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Column Mappings ({columns.length} columns)
                </Label>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleRefreshPreview}
                  className="gap-1"
                >
                  <RefreshCw className="size-3" />
                  Refresh previews
                </Button>
              </div>

              <div className="rounded-md border overflow-hidden">
                {/* Header */}
                <div className="grid grid-cols-[150px_80px_170px_1fr] gap-2 px-3 py-1.5 bg-muted text-xs font-medium text-muted-foreground">
                  <div>Column</div>
                  <div>Type</div>
                  <div>Provider</div>
                  <div>Preview</div>
                </div>

                {/* Rows */}
                <div className="max-h-[300px] overflow-y-auto">
                  {columns.map((col) => {
                    const providerId = columnProviders[col.name] ?? 'text.word';
                    return (
                      <ColumnRow
                        key={col.name}
                        name={col.name}
                        dataType={col.data_type}
                        isPrimaryKey={col.is_primary_key}
                        nullable={col.nullable}
                        providerId={providerId}
                        onProviderChange={(pid) => setProvider(col.name, pid)}
                        getPreviewValues={getPreviewValues}
                        previewKey={previewKey}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* No table selected */}
          {!selectedTable && (
            <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
              <Table2 className="size-8" />
              <p className="text-sm">Select a database and table to configure data generation.</p>
            </div>
          )}

          {/* Row count */}
          {columns.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Number of rows</Label>
              <div className="flex gap-1.5">
                {ROW_COUNT_OPTIONS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setRowCount(count)}
                    className={cn(
                      'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                      rowCount === count
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:bg-accent'
                    )}
                  >
                    {count.toLocaleString()}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <pre className="whitespace-pre-wrap text-xs">{error}</pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          {columns.length > 0 && (
            <>
              <Button
                variant="outline"
                onClick={generateAndExportCSV}
                disabled={generating}
              >
                <Download className="size-4" />
                Export CSV
              </Button>
              <Button
                onClick={handleGenInsert}
                disabled={generating || !activeConnectionId}
              >
                {generating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4" />
                    Generate & Insert
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ColumnRowProps {
  name: string;
  dataType: string;
  isPrimaryKey: boolean;
  nullable: boolean;
  providerId: string;
  onProviderChange: (pid: string) => void;
  getPreviewValues: (pid: string, count?: number) => (string | number | boolean)[];
  previewKey: number;
}

function ColumnRow({
  name,
  dataType,
  isPrimaryKey,
  nullable,
  providerId,
  onProviderChange,
  getPreviewValues,
  previewKey,
}: ColumnRowProps) {
  const previews = useMemo(() => {
    return getPreviewValues(providerId, 5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, previewKey, getPreviewValues]);

  return (
    <div className="grid grid-cols-[150px_80px_170px_1fr] gap-2 items-center px-3 py-1.5 border-t text-xs">
      {/* Column name */}
      <div className="flex items-center gap-1 truncate font-medium">
        {name}
        {isPrimaryKey && (
          <Badge variant="outline" className="text-[9px] px-1 py-0">
            PK
          </Badge>
        )}
      </div>

      {/* Type */}
      <div className="truncate">
        <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
          {dataType}
        </Badge>
      </div>

      {/* Provider select */}
      <ProviderSelect value={providerId} onValueChange={onProviderChange} />

      {/* Preview values */}
      <div className="flex gap-1 overflow-hidden">
        {previews.map((val, i) => (
          <span
            key={i}
            className="inline-block max-w-[90px] truncate rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono"
            title={String(val)}
          >
            {String(val)}
          </span>
        ))}
      </div>
    </div>
  );
}
