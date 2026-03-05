import { memo, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { Key, Link, ChevronDown, ChevronRight, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useERDiagramStore } from '@/stores/erDiagramStore';
import type { ERNode, ERColumnInfo } from '@/stores/erDiagramStore';

function ColumnRow({ column }: { column: ERColumnInfo }) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-3 py-1 text-xs border-b border-border/50 last:border-b-0',
        'hover:bg-accent/50 transition-colors'
      )}
    >
      {/* PK / FK icon */}
      <span className="flex w-4 shrink-0 items-center justify-center">
        {column.isPK ? (
          <Key className="size-3 text-yellow-500" />
        ) : column.isFK ? (
          <Link className="size-3 text-blue-500" />
        ) : (
          <Circle className="size-2 text-muted-foreground/40" />
        )}
      </span>

      {/* Column name */}
      <span
        className={cn(
          'flex-1 truncate font-mono',
          column.isPK && 'font-semibold'
        )}
      >
        {column.name}
      </span>

      {/* Data type */}
      <span className="shrink-0 text-muted-foreground font-mono">
        {column.type}
      </span>

      {/* Nullable indicator */}
      {column.nullable && (
        <span className="shrink-0 text-muted-foreground/60 text-[10px]">
          ?
        </span>
      )}
    </div>
  );
}

function TableNodeComponent({ id, data }: NodeProps<ERNode>) {
  const toggleNodeCollapsed = useERDiagramStore((s) => s.toggleNodeCollapsed);
  const { tableName, columns, collapsed } = data;

  const handleToggle = useCallback(() => {
    toggleNodeCollapsed(id);
  }, [id, toggleNodeCollapsed]);

  return (
    <div
      className={cn(
        'min-w-[200px] max-w-[320px] rounded-lg border border-border bg-card shadow-md',
        'transition-shadow hover:shadow-lg'
      )}
    >
      {/* Target handle (incoming FK references) */}
      <Handle
        type="target"
        position={Position.Top}
        id={`${id}-target`}
        className="!w-2 !h-2 !bg-blue-500 !border-background !border-2"
      />

      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer select-none',
          'bg-muted/60 rounded-t-lg border-b border-border',
          collapsed && 'rounded-b-lg'
        )}
        onClick={handleToggle}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="flex-1 truncate text-sm font-semibold">
          {tableName}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {columns.length}
        </span>
      </div>

      {/* Columns */}
      {!collapsed && columns.length > 0 && (
        <div className="max-h-[300px] overflow-y-auto">
          {columns.map((col) => (
            <ColumnRow key={col.name} column={col} />
          ))}
        </div>
      )}

      {/* Source handle (outgoing FK references) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id={`${id}-source`}
        className="!w-2 !h-2 !bg-green-500 !border-background !border-2"
      />
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
