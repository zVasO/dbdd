import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
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
  Eye,
  Hash,
  Info,
  Loader2,
  Star,
  Table2,
  Terminal,
  Trash2,
  Eraser,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePreferencesStore } from '@/stores/preferencesStore';
import type { TableInfo, ColumnInfo } from '@/lib/types';
import { formatBytes, formatDataType, HighlightMatch } from './utils';
import { ColumnNode } from './ColumnNode';

export interface TableNodeProps {
  table: TableInfo;
  dbName: string;
  expanded: boolean;
  loading: boolean;
  columns: ColumnInfo[] | undefined;
  onToggle: () => void;
  onClick: () => void;
  onColumnClick: (column: ColumnInfo) => void;
  selectedColumn: ColumnInfo | null;
  searchQuery: string;
  onTruncate: () => void;
  onDrop: () => void;
  onRename: () => void;
  /** Called when a column is double-clicked — opens the parent table and highlights the column */
  onColumnDoubleClick?: (colName: string) => void;
  /** Render without database-level indentation (flat mode) */
  flat?: boolean;
  isFavorited?: boolean;
  onToggleFavorite?: () => void;
}

export function TableNode({
  table,
  expanded,
  loading,
  columns,
  onToggle,
  onClick,
  onColumnClick,
  onColumnDoubleClick,
  selectedColumn,
  onTruncate,
  onDrop,
  onRename,
  searchQuery,
  flat,
  isFavorited,
  onToggleFavorite,
}: TableNodeProps) {
  const isView = table.table_type === 'View';
  const TableIcon = isView ? Eye : Table2;

  return (
    <Collapsible open={expanded}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className={cn("group flex items-center", flat ? "pl-2" : "pl-5")}>
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
                  <span className="truncate text-sidebar-foreground">
                    <HighlightMatch text={table.name} query={searchQuery} />
                  </span>
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
                  {table.row_count_estimate != null && ` \u00b7 ~${table.row_count_estimate.toLocaleString()} rows`}
                  {table.size_bytes != null && ` \u00b7 ${formatBytes(table.size_bytes)}`}
                </p>
                {table.comment && <p className="mt-1 text-muted-foreground">{table.comment}</p>}
              </TooltipContent>
            </Tooltip>

            {onToggleFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite();
                }}
                className={cn(
                  'flex-shrink-0 p-0.5 rounded-sm transition-opacity',
                  isFavorited ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <Star className={cn(
                  'w-3 h-3',
                  isFavorited
                    ? 'text-yellow-500 fill-yellow-500'
                    : 'text-muted-foreground hover:text-yellow-500',
                )} />
              </button>
            )}
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
            const _ps = usePreferencesStore.getState().defaultPageSize;
            navigator.clipboard.writeText(_ps > 0 ? `SELECT * FROM \`${table.name}\` LIMIT ${_ps}` : `SELECT * FROM \`${table.name}\``);
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
          <ContextMenuSeparator />
          <ContextMenuItem onClick={onRename}>
            <Pencil className="mr-2 h-3.5 w-3.5" /> Rename Table
          </ContextMenuItem>
          <ContextMenuItem onClick={onTruncate}>
            <Eraser className="mr-2 h-3.5 w-3.5" /> Truncate Table
          </ContextMenuItem>
          <ContextMenuItem onClick={onDrop} className="text-destructive focus:text-destructive">
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Drop Table
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <CollapsibleContent>
        {columns && columns.length > 0 && (
          <div className={cn("border-l border-sidebar-border", flat ? "ml-7" : "ml-10")}>
            {columns.map((col) => {
              // When searching by column name, only show matching columns
              if (searchQuery && !table.name.toLowerCase().includes(searchQuery) && !col.name.toLowerCase().includes(searchQuery)) {
                return null;
              }
              return (
                <ColumnNode
                  key={col.name}
                  column={col}
                  selected={
                    selectedColumn?.name === col.name &&
                    selectedColumn?.ordinal_position === col.ordinal_position
                  }
                  onClick={() => onColumnClick(col)}
                  onDoubleClick={onColumnDoubleClick ? () => onColumnDoubleClick(col.name) : undefined}
                  searchQuery={searchQuery}
                />
              );
            })}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
