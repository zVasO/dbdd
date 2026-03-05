import { useState } from 'react';
import {
  Plus,
  Minus,
  ArrowUpDown,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { TableDiff, ColumnDiff } from '@/stores/migrationStore';

interface SchemaDiffProps {
  diff: TableDiff[];
}

const TYPE_CONFIG = {
  added: {
    icon: Plus,
    color: 'text-green-600 dark:text-green-400',
    bg: 'bg-green-500/10',
    badge: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    label: 'Added',
  },
  removed: {
    icon: Minus,
    color: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    label: 'Removed',
  },
  modified: {
    icon: ArrowUpDown,
    color: 'text-yellow-600 dark:text-yellow-400',
    bg: 'bg-yellow-500/10',
    badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    label: 'Modified',
  },
} as const;

function ColumnDiffRow({ diff }: { diff: ColumnDiff }) {
  const config = TYPE_CONFIG[diff.type];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-1.5 text-xs rounded-sm',
        config.bg,
      )}
    >
      <Icon className={cn('size-3 shrink-0', config.color)} />
      <span className="font-mono font-medium">{diff.columnName}</span>

      {diff.type === 'added' && diff.sourceType && (
        <span className="text-muted-foreground">{diff.sourceType}</span>
      )}

      {diff.type === 'removed' && diff.targetType && (
        <span className="text-muted-foreground line-through">
          {diff.targetType}
        </span>
      )}

      {diff.type === 'modified' && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <span className="line-through">{diff.targetType}</span>
          <ArrowRight className="size-3" />
          <span className="font-medium text-foreground">{diff.sourceType}</span>
        </span>
      )}

      {diff.type === 'modified' &&
        diff.sourceNullable !== diff.targetNullable && (
          <Badge variant="outline" className="text-[10px] px-1 py-0">
            {diff.sourceNullable ? 'NULLABLE' : 'NOT NULL'}
          </Badge>
        )}

      {diff.type === 'modified' &&
        diff.sourceDefault !== diff.targetDefault && (
          <span className="text-muted-foreground">
            default: {diff.sourceDefault ?? 'none'}
          </span>
        )}

      {diff.type === 'added' && diff.sourceNullable === false && (
        <Badge variant="outline" className="text-[10px] px-1 py-0">
          NOT NULL
        </Badge>
      )}
    </div>
  );
}

function TableDiffRow({ diff }: { diff: TableDiff }) {
  const [open, setOpen] = useState(false);
  const config = TYPE_CONFIG[diff.type];
  const Icon = config.icon;
  const hasColumns = diff.columns && diff.columns.length > 0;
  const isExpandable = diff.type === 'modified' && hasColumns;

  if (isExpandable) {
    return (
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm transition-colors',
              'hover:bg-muted/50 cursor-pointer text-left',
              config.bg,
            )}
          >
            <ChevronRight
              className={cn(
                'size-3.5 shrink-0 transition-transform',
                open && 'rotate-90',
              )}
            />
            <Icon className={cn('size-4 shrink-0', config.color)} />
            <span className="font-mono font-medium">{diff.tableName}</span>
            <span
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                config.badge,
              )}
            >
              {config.label}
            </span>
            {diff.columns && (
              <span className="text-xs text-muted-foreground ml-auto">
                {diff.columns.length} column{diff.columns.length !== 1 ? 's' : ''} changed
              </span>
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-0.5 pl-10 pr-3 pb-2 pt-1">
            {diff.columns?.map((colDiff) => (
              <ColumnDiffRow key={colDiff.columnName} diff={colDiff} />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md text-sm',
        config.bg,
      )}
    >
      <div className="w-3.5" /> {/* spacer to align with expandable rows */}
      <Icon className={cn('size-4 shrink-0', config.color)} />
      <span className="font-mono font-medium">{diff.tableName}</span>
      <span
        className={cn(
          'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
          config.badge,
        )}
      >
        {config.label}
      </span>
      {diff.type === 'added' && diff.columns && (
        <span className="text-xs text-muted-foreground ml-auto">
          {diff.columns.length} column{diff.columns.length !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  );
}

export function SchemaDiff({ diff }: SchemaDiffProps) {
  if (diff.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
        <p className="text-sm">No differences found</p>
        <p className="text-xs mt-1">The schemas are identical.</p>
      </div>
    );
  }

  const addedCount = diff.filter((d) => d.type === 'added').length;
  const removedCount = diff.filter((d) => d.type === 'removed').length;
  const modifiedCount = diff.filter((d) => d.type === 'modified').length;

  return (
    <div className="flex flex-col gap-2">
      {/* Summary */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {diff.length} table{diff.length !== 1 ? 's' : ''} differ:
        </span>
        {addedCount > 0 && (
          <Badge variant="outline" className="text-[10px] text-green-600 dark:text-green-400">
            +{addedCount} added
          </Badge>
        )}
        {modifiedCount > 0 && (
          <Badge variant="outline" className="text-[10px] text-yellow-600 dark:text-yellow-400">
            ~{modifiedCount} modified
          </Badge>
        )}
        {removedCount > 0 && (
          <Badge variant="outline" className="text-[10px] text-red-600 dark:text-red-400">
            -{removedCount} removed
          </Badge>
        )}
      </div>

      {/* Diff list */}
      <div className="flex flex-col gap-1 max-h-[400px] overflow-y-auto rounded-md border p-2">
        {diff.map((tableDiff) => (
          <TableDiffRow key={tableDiff.tableName} diff={tableDiff} />
        ))}
      </div>
    </div>
  );
}
