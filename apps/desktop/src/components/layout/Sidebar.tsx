import { useState } from 'react';
import { useSchemaStore } from '@/stores/schemaStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { useQueryStore } from '@/stores/queryStore';
import { useUIStore } from '@/stores/uiStore';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  ChevronRight,
  Copy,
  Database,
  Hash,
  Info,
  Table2,
  Eye,
  Columns3,
  Key,
  Loader2,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TableInfo, ColumnInfo } from '@/lib/types';

export function Sidebar() {
  const { sidebarOpen } = useUIStore();
  const { databases, tables, structures, structureLoading, loadTables, loadTableStructure } =
    useSchemaStore();
  const activeConnectionId = useConnectionStore((s) => s.activeConnectionId);
  const activeConfig = useConnectionStore((s) => s.activeConfig);
  const { createTab, updateSql, executeQuery } = useQueryStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [selectedColumn, setSelectedColumn] = useState<ColumnInfo | null>(null);

  if (!sidebarOpen) return null;

  const toggleDb = (dbName: string) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
        if (activeConnectionId && !tables[dbName]) {
          loadTables(activeConnectionId, dbName);
        }
      }
      return next;
    });
  };

  const toggleTable = (dbName: string, tableName: string) => {
    const key = `${dbName}.${tableName}`;
    setExpandedTables((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
        if (activeConnectionId && !structures[key]) {
          loadTableStructure(activeConnectionId, {
            database: dbName,
            schema: null,
            table: tableName,
          });
        }
      }
      return next;
    });
  };

  const handleTableClick = (db: string, tableName: string) => {
    if (!activeConnectionId) return;
    const sql = `SELECT * FROM \`${tableName}\` LIMIT 500`;
    const tabId = createTab(tableName, { editorVisible: false, database: db, table: tableName });
    updateSql(tabId, sql);
    executeQuery(activeConnectionId, tabId);
  };

  const handleColumnClick = (column: ColumnInfo) => {
    setSelectedColumn((prev) =>
      prev?.name === column.name && prev?.ordinal_position === column.ordinal_position
        ? null
        : column,
    );
  };

  return (
    <TooltipProvider delayDuration={400}>
      <div
        className="flex flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        style={{ width: 'var(--sidebar-width)' }}
      >
        <div className="flex items-center justify-between border-b border-sidebar-border px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {activeConfig?.name || 'Explorer'}
          </span>
        </div>

        <div className="border-b border-sidebar-border px-2 py-1.5">
          <div className="flex items-center gap-1.5 rounded-sm bg-sidebar-accent/50 px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
            <input
              className="flex-1 bg-transparent text-xs text-sidebar-foreground placeholder:text-muted-foreground outline-none"
              placeholder="Search tables..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="text-muted-foreground hover:text-sidebar-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="py-1">
            {databases.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No databases found
              </p>
            ) : (
              (() => {
                const filteredDatabases = searchQuery
                  ? databases.filter((db) => {
                      const dbMatch = db.name.toLowerCase().includes(searchQuery.toLowerCase());
                      const tableMatch = tables[db.name]?.some((t) =>
                        t.name.toLowerCase().includes(searchQuery.toLowerCase())
                      );
                      return dbMatch || tableMatch;
                    })
                  : databases;

                return filteredDatabases.map((db) => (
                  <DatabaseNode
                    key={db.name}
                    name={db.name}
                    sizeBytes={db.size_bytes}
                    expanded={expandedDbs.has(db.name) || (!!searchQuery && tables[db.name]?.some((t) =>
                      t.name.toLowerCase().includes(searchQuery.toLowerCase())
                    ))}
                    onToggle={() => toggleDb(db.name)}
                    tables={tables[db.name] ?? []}
                    expandedTables={expandedTables}
                    structures={structures}
                    structureLoading={structureLoading}
                    dbName={db.name}
                    onToggleTable={toggleTable}
                    onTableClick={handleTableClick}
                    onColumnClick={handleColumnClick}
                    selectedColumn={selectedColumn}
                  />
                ));
              })()
            )}
          </div>
        </ScrollArea>

        {/* Column properties panel */}
        {selectedColumn && (
          <ColumnProperties column={selectedColumn} onClose={() => setSelectedColumn(null)} />
        )}
      </div>
    </TooltipProvider>
  );
}

// ─── Column properties panel ──────────────────────────────────────────────────

function ColumnProperties({ column, onClose }: { column: ColumnInfo; onClose: () => void }) {
  return (
    <div className="border-t border-sidebar-border">
      <div className="flex items-center justify-between px-3 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Properties
        </span>
        <button
          onClick={onClose}
          className="rounded-sm p-0.5 hover:bg-sidebar-accent"
        >
          <X className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
      <Separator />
      <div className="space-y-1.5 px-3 py-2 text-[11px]">
        <PropertyRow label="Name" value={column.name} highlight />
        <PropertyRow label="Type" value={column.data_type} />
        <PropertyRow label="Mapped" value={column.mapped_type} />
        <PropertyRow label="Nullable" value={column.nullable ? 'Yes' : 'No'} />
        <PropertyRow label="Primary Key" value={column.is_primary_key ? 'Yes' : 'No'} />
        <PropertyRow label="Position" value={String(column.ordinal_position)} />
        {column.default_value != null && (
          <PropertyRow label="Default" value={column.default_value} />
        )}
        {column.comment && (
          <PropertyRow label="Comment" value={column.comment} />
        )}
      </div>
    </div>
  );
}

function PropertyRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'truncate text-right',
          highlight ? 'font-medium text-sidebar-foreground' : 'text-sidebar-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Database node ────────────────────────────────────────────────────────────

interface DatabaseNodeProps {
  name: string;
  sizeBytes: number | null;
  expanded: boolean;
  onToggle: () => void;
  tables: TableInfo[];
  expandedTables: Set<string>;
  structures: Record<string, { columns: ColumnInfo[] }>;
  structureLoading: Record<string, boolean>;
  dbName: string;
  onToggleTable: (db: string, table: string) => void;
  onTableClick: (db: string, table: string) => void;
  onColumnClick: (column: ColumnInfo) => void;
  selectedColumn: ColumnInfo | null;
}

function DatabaseNode({
  name,
  sizeBytes,
  expanded,
  onToggle,
  tables,
  expandedTables,
  structures,
  structureLoading,
  dbName,
  onToggleTable,
  onTableClick,
  onColumnClick,
  selectedColumn,
}: DatabaseNodeProps) {
  return (
    <Collapsible open={expanded} onOpenChange={onToggle}>
      <CollapsibleTrigger asChild>
        <button className="group flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-sm hover:bg-sidebar-accent">
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
          <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium text-sidebar-foreground">{name}</span>
          {sizeBytes != null && (
            <span className="ml-auto text-[10px] text-muted-foreground">
              {formatBytes(sizeBytes)}
            </span>
          )}
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent>
        {tables.length === 0 ? (
          <p className="py-1 pl-9 text-[11px] text-muted-foreground">No tables</p>
        ) : (
          tables.map((table) => {
            const key = `${dbName}.${table.name}`;
            return (
              <TableNode
                key={table.name}
                table={table}
                dbName={dbName}
                expanded={expandedTables.has(key)}
                loading={structureLoading[key] ?? false}
                columns={structures[key]?.columns}
                onToggle={() => onToggleTable(dbName, table.name)}
                onClick={() => onTableClick(dbName, table.name)}
                onColumnClick={onColumnClick}
                selectedColumn={selectedColumn}
              />
            );
          })
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Table node ───────────────────────────────────────────────────────────────

interface TableNodeProps {
  table: TableInfo;
  dbName: string;
  expanded: boolean;
  loading: boolean;
  columns: ColumnInfo[] | undefined;
  onToggle: () => void;
  onClick: () => void;
  onColumnClick: (column: ColumnInfo) => void;
  selectedColumn: ColumnInfo | null;
}

function TableNode({
  table,
  expanded,
  loading,
  columns,
  onToggle,
  onClick,
  onColumnClick,
  selectedColumn,
}: TableNodeProps) {
  const isView = table.table_type === 'View';
  const TableIcon = isView ? Eye : Table2;

  return (
    <Collapsible open={expanded}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="flex items-center pl-5">
            {/* Expand/collapse chevron */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-sidebar-accent"
            >
              {loading ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <ChevronRight
                  className={cn(
                    'h-3 w-3 text-muted-foreground transition-transform duration-200',
                    expanded && 'rotate-90',
                  )}
                />
              )}
            </button>

            {/* Table name — click to query */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onClick}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-sidebar-accent"
                >
                  <TableIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isView ? 'text-accent-foreground' : 'text-muted-foreground',
                    )}
                  />
                  <span className="truncate text-sidebar-foreground">{table.name}</span>
                  {table.row_count_estimate != null && (
                    <Badge variant="secondary" className="ml-auto h-4 px-1 text-[9px]">
                      ~{table.row_count_estimate.toLocaleString()}
                    </Badge>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">
                <p className="font-medium">{table.name}</p>
                <p className="text-muted-foreground">
                  {isView ? 'View' : 'Table'}
                  {table.row_count_estimate != null && ` · ~${table.row_count_estimate.toLocaleString()} rows`}
                  {table.size_bytes != null && ` · ${formatBytes(table.size_bytes)}`}
                </p>
                {table.comment && <p className="mt-1 text-muted-foreground">{table.comment}</p>}
              </TooltipContent>
            </Tooltip>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={onClick}>
            <Table2 className="mr-2 h-3.5 w-3.5" /> Open Table
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(table.name);
          }}>
            <Copy className="mr-2 h-3.5 w-3.5" /> Copy Name
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(`SELECT * FROM \`${table.name}\` LIMIT 500`);
          }}>
            <Terminal className="mr-2 h-3.5 w-3.5" /> Copy SELECT Query
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(`SELECT COUNT(*) FROM \`${table.name}\``);
          }}>
            <Hash className="mr-2 h-3.5 w-3.5" /> Copy COUNT Query
          </ContextMenuItem>
          <ContextMenuItem onClick={() => {
            navigator.clipboard.writeText(`DESCRIBE \`${table.name}\``);
          }}>
            <Info className="mr-2 h-3.5 w-3.5" /> Copy DESCRIBE Query
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CollapsibleContent>
        {columns && columns.length > 0 && (
          <div className="ml-10 border-l border-sidebar-border">
            {columns.map((col) => (
              <ColumnNode
                key={col.name}
                column={col}
                selected={
                  selectedColumn?.name === col.name &&
                  selectedColumn?.ordinal_position === col.ordinal_position
                }
                onClick={() => onColumnClick(col)}
              />
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Column node ──────────────────────────────────────────────────────────────

interface ColumnNodeProps {
  column: ColumnInfo;
  selected: boolean;
  onClick: () => void;
}

function ColumnNode({ column, selected, onClick }: ColumnNodeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            'flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] hover:bg-sidebar-accent',
            selected && 'bg-sidebar-accent',
          )}
        >
          {column.is_primary_key ? (
            <Key className="h-3 w-3 shrink-0 text-primary" />
          ) : (
            <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              'truncate',
              column.is_primary_key
                ? 'font-medium text-sidebar-foreground'
                : 'text-muted-foreground',
            )}
          >
            {column.name}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
            {column.data_type}
          </span>
          {column.nullable && (
            <span className="text-[9px] text-muted-foreground/60">?</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <p>
          <span className="font-medium">{column.name}</span>{' '}
          <span className="text-muted-foreground">{column.data_type}</span>
        </p>
        <p className="text-muted-foreground">
          {column.nullable ? 'Nullable' : 'Not null'}
          {column.is_primary_key && ' · Primary key'}
          {column.default_value != null && ` · Default: ${column.default_value}`}
        </p>
        {column.comment && <p className="mt-1 text-muted-foreground">{column.comment}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
