import React from 'react';
import { Badge } from '@/components/ui/badge';
import {
  ChevronRight,
  Columns3,
  Database,
  Eye,
  Key,
  Loader2,
  Star,
  Table2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from './utils';
import type { FlatNode } from './sidebarTree';

export interface SidebarRowHandlers {
  onRowClick: (e: React.MouseEvent<HTMLElement>) => void;
  onRowDoubleClick: (e: React.MouseEvent<HTMLElement>) => void;
  onRowContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onCaretClick: (e: React.MouseEvent<HTMLElement>) => void;
}

export const ROW_HEIGHT: Record<FlatNode['kind'], number> = {
  db: 28,
  table: 24,
  column: 20,
};

export interface SidebarRowProps {
  node: FlatNode;
  isActive: boolean;
  isFavorite: boolean;
  handlers: SidebarRowHandlers;
}

function tableTitle(node: Extract<FlatNode, { kind: 'table' }>): string {
  const facts = [node.isView ? 'View' : 'Table'];
  if (node.rowCountEstimate != null) facts.push(`~${node.rowCountEstimate.toLocaleString()} rows`);
  if (node.sizeBytes != null) facts.push(formatBytes(node.sizeBytes));
  const lines = [node.table, facts.join(' · ')];
  if (node.comment) lines.push(node.comment);
  return lines.join('\n');
}

function columnTitle(node: Extract<FlatNode, { kind: 'column' }>): string {
  const facts = [node.nullable ? 'Nullable' : 'Not null'];
  if (node.isPk) facts.push('Primary key');
  if (node.isFk) facts.push('Foreign key');
  if (node.defaultValue != null) facts.push(`Default: ${node.defaultValue}`);
  const lines = [`${node.name} ${node.dataType}`, facts.join(' · ')];
  if (node.comment) lines.push(node.comment);
  lines.push('Double-click to open table');
  return lines.join('\n');
}

export const SidebarRow = React.memo(function SidebarRow({
  node,
  isActive,
  isFavorite,
  handlers,
}: SidebarRowProps) {
  if (node.kind === 'db') {
    return (
      <div
        data-kind="db"
        data-key={node.key}
        data-db={node.db}
        onClick={handlers.onRowClick}
        onContextMenu={handlers.onRowContextMenu}
        className="flex h-full items-center"
      >
        <button
          className="flex h-full w-full items-center gap-1.5 rounded-sm px-2 text-left text-sm hover:bg-sidebar-accent"
          title={node.db}
        >
          <ChevronRight
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
              node.expanded && 'rotate-90',
            )}
          />
          <Database className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium text-sidebar-foreground">{node.db}</span>
          {node.expanded && node.tableCount === 0 && (
            <span className="shrink-0 text-[11px] text-muted-foreground">No tables</span>
          )}
          {node.sizeBytes != null && (
            <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
              {formatBytes(node.sizeBytes)}
            </span>
          )}
        </button>
      </div>
    );
  }

  if (node.kind === 'table') {
    const TableIcon = node.isView ? Eye : Table2;
    return (
      <div
        data-kind="table"
        data-key={node.key}
        data-db={node.db}
        data-table={node.table}
        onClick={handlers.onRowClick}
        onContextMenu={handlers.onRowContextMenu}
        className={cn('group flex h-full items-center', node.depth === 1 ? 'pl-5' : 'pl-2')}
      >
        <button
          data-act="caret"
          onClick={handlers.onCaretClick}
          className="flex h-6 w-5 shrink-0 items-center justify-center rounded-sm hover:bg-sidebar-accent"
        >
          {node.loading ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : (
            <ChevronRight
              className={cn(
                'h-3 w-3 text-muted-foreground transition-transform duration-200',
                node.expanded && 'rotate-90',
              )}
            />
          )}
        </button>

        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-0.5 text-left text-xs hover:bg-sidebar-accent"
          title={tableTitle(node)}
        >
          <TableIcon
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              node.isView ? 'text-accent-foreground' : 'text-muted-foreground',
            )}
          />
          <span className="truncate text-sidebar-foreground">{node.table}</span>
          {node.rowCountEstimate != null && (
            <Badge variant="secondary" className="ml-auto h-4 px-1 text-[10px]">
              ~{node.rowCountEstimate.toLocaleString()}
            </Badge>
          )}
        </button>

        <button
          data-act="fav"
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className={cn(
            'flex-shrink-0 p-0.5 rounded-sm transition-opacity',
            isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <Star
            className={cn(
              'w-3 h-3',
              isFavorite
                ? 'text-yellow-500 fill-yellow-500'
                : 'text-muted-foreground hover:text-yellow-500',
            )}
          />
        </button>
      </div>
    );
  }

  return (
    <div
      data-kind="column"
      data-key={node.key}
      data-db={node.db}
      data-table={node.table}
      data-colname={node.name}
      data-ordinal={node.ordinalPosition}
      onClick={handlers.onRowClick}
      onDoubleClick={handlers.onRowDoubleClick}
      onContextMenu={handlers.onRowContextMenu}
      className="flex h-full items-stretch"
    >
      <div
        className="shrink-0 border-r border-sidebar-border"
        style={{ width: node.depth === 2 ? 40 : 28 }}
      />
      <button
        title={columnTitle(node)}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-[11px] hover:bg-sidebar-accent',
          isActive && 'bg-sidebar-accent',
        )}
      >
        {node.isPk ? (
          <Key className="h-3 w-3 shrink-0 text-primary" />
        ) : (
          <Columns3 className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span
          className={cn(
            'truncate',
            node.isPk ? 'font-medium text-sidebar-foreground' : 'text-muted-foreground',
          )}
        >
          {node.name}
        </span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{node.dataType}</span>
        {node.nullable && <span className="shrink-0 text-[10px] text-muted-foreground/60">?</span>}
      </button>
    </div>
  );
});
