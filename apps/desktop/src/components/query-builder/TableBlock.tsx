import { memo, useCallback } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import { X, Key, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useQueryBuilderStore } from '@/stores/queryBuilderStore';
import type { TableNodeData } from '@/stores/queryBuilderStore';

type TableBlockNode = Node<TableNodeData, 'tableBlock'>;

function ColumnRow({
  nodeId,
  column,
  isSelected,
}: {
  nodeId: string;
  column: { name: string; type: string; isPK: boolean; nullable: boolean };
  isSelected: boolean;
}) {
  const toggleColumn = useQueryBuilderStore((s) => s.toggleColumn);

  const handleToggle = useCallback(() => {
    toggleColumn(nodeId, column.name);
  }, [nodeId, column.name, toggleColumn]);

  return (
    <div
      className={cn(
        'group/col relative flex items-center gap-1.5 px-2 py-1 text-xs border-b border-border/30 last:border-b-0',
        'hover:bg-accent/50 transition-colors cursor-pointer',
        isSelected && 'bg-accent/30'
      )}
      onClick={handleToggle}
    >
      {/* Left handle for connections */}
      <Handle
        type="target"
        position={Position.Left}
        id={`${nodeId}__${column.name}__left`}
        className="!w-2 !h-2 !bg-blue-500 !border-background !border-[1.5px] !-left-1"
        style={{ top: 'auto' }}
      />

      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={handleToggle}
        className="size-3 shrink-0 accent-primary cursor-pointer"
        onClick={(e) => e.stopPropagation()}
      />

      {/* PK icon */}
      <span className="flex w-3 shrink-0 items-center justify-center">
        {column.isPK ? (
          <Key className="size-2.5 text-yellow-500" />
        ) : (
          <Circle className="size-1.5 text-muted-foreground/30" />
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

      {/* Data type badge */}
      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] font-mono text-muted-foreground">
        {column.type}
      </span>

      {/* Nullable indicator */}
      {column.nullable && (
        <span className="shrink-0 text-muted-foreground/50 text-[9px]">?</span>
      )}

      {/* Right handle for connections */}
      <Handle
        type="source"
        position={Position.Right}
        id={`${nodeId}__${column.name}__right`}
        className="!w-2 !h-2 !bg-green-500 !border-background !border-[1.5px] !-right-1"
        style={{ top: 'auto' }}
      />
    </div>
  );
}

function TableBlockComponent({ id, data }: NodeProps<TableBlockNode>) {
  const removeTable = useQueryBuilderStore((s) => s.removeTable);
  const selectAllColumns = useQueryBuilderStore((s) => s.selectAllColumns);
  const deselectAllColumns = useQueryBuilderStore((s) => s.deselectAllColumns);

  const { tableName, columns, selectedColumns } = data;

  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      removeTable(id);
    },
    [id, removeTable]
  );

  const handleSelectAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      selectAllColumns(id);
    },
    [id, selectAllColumns]
  );

  const handleDeselectAll = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      deselectAllColumns(id);
    },
    [id, deselectAllColumns]
  );

  const allSelected = selectedColumns.length === columns.length;
  const noneSelected = selectedColumns.length === 0;

  return (
    <div
      className={cn(
        'min-w-[220px] max-w-[300px] rounded-lg border border-border bg-card shadow-md',
        'transition-shadow hover:shadow-lg'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2',
          'bg-primary/10 rounded-t-lg border-b border-border'
        )}
      >
        <span className="flex-1 truncate text-sm font-semibold text-primary">
          {tableName}
        </span>
        <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {selectedColumns.length}/{columns.length}
        </span>
        <button
          onClick={handleRemove}
          className="shrink-0 rounded p-0.5 hover:bg-destructive/20 hover:text-destructive transition-colors"
          title="Remove table"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {/* Select All / Deselect All links */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-border/30 bg-muted/30">
        <button
          onClick={handleSelectAll}
          disabled={allSelected}
          className={cn(
            'text-[10px] font-medium transition-colors',
            allSelected
              ? 'text-muted-foreground/40 cursor-default'
              : 'text-primary hover:text-primary/80 cursor-pointer'
          )}
        >
          Select All
        </button>
        <span className="text-muted-foreground/30 text-[10px]">|</span>
        <button
          onClick={handleDeselectAll}
          disabled={noneSelected}
          className={cn(
            'text-[10px] font-medium transition-colors',
            noneSelected
              ? 'text-muted-foreground/40 cursor-default'
              : 'text-primary hover:text-primary/80 cursor-pointer'
          )}
        >
          Deselect All
        </button>
      </div>

      {/* Column list */}
      {columns.length > 0 && (
        <div className="max-h-[240px] overflow-y-auto">
          {columns.map((col) => (
            <ColumnRow
              key={col.name}
              nodeId={id}
              column={col}
              isSelected={selectedColumns.includes(col.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const TableBlock = memo(TableBlockComponent);
