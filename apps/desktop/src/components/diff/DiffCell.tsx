import { cn } from '@/lib/utils';
import type { CellValue } from '@/lib/types';

export type DiffStatus = 'unchanged' | 'changed' | 'added' | 'removed';

interface DiffCellProps {
  left: CellValue | null;
  right: CellValue | null;
  status: DiffStatus;
}

function formatCellValue(cell: CellValue | null): string {
  if (cell === null) return '';
  switch (cell.type) {
    case 'Null':
      return 'NULL';
    case 'Text':
    case 'Uuid':
    case 'DateTime':
    case 'Date':
    case 'Time':
      return cell.value;
    case 'Integer':
    case 'Float':
      return String(cell.value);
    case 'Boolean':
      return cell.value ? 'true' : 'false';
    case 'Json':
      return typeof cell.value === 'string'
        ? cell.value
        : JSON.stringify(cell.value);
    case 'Bytes':
      return `[${cell.value.size} bytes]`;
    case 'Array':
      return `[${cell.value.length} items]`;
  }
}

function getStatusClasses(status: DiffStatus, side: 'left' | 'right'): string {
  switch (status) {
    case 'unchanged':
      return '';
    case 'changed':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    case 'added':
      return side === 'right'
        ? 'bg-green-500/10 text-green-700 dark:text-green-400'
        : 'bg-muted/50 text-muted-foreground';
    case 'removed':
      return side === 'left'
        ? 'bg-red-500/10 text-red-700 dark:text-red-400'
        : 'bg-muted/50 text-muted-foreground';
  }
}

export function DiffCell({ left, right, status }: DiffCellProps) {
  const leftValue = formatCellValue(left);
  const rightValue = formatCellValue(right);

  return (
    <div className="flex">
      {/* Left side */}
      <div
        className={cn(
          'flex-1 px-2 py-1 text-xs font-mono truncate border-r',
          getStatusClasses(status, 'left'),
        )}
        title={leftValue}
      >
        {status === 'added' ? '' : leftValue}
      </div>

      {/* Right side */}
      <div
        className={cn(
          'flex-1 px-2 py-1 text-xs font-mono truncate',
          getStatusClasses(status, 'right'),
        )}
        title={rightValue}
      >
        {status === 'removed' ? '' : rightValue}
      </div>
    </div>
  );
}

export function compareCellValues(
  a: CellValue | null,
  b: CellValue | null,
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.type !== b.type) return false;

  switch (a.type) {
    case 'Null':
      return b.type === 'Null';
    case 'Text':
    case 'Uuid':
    case 'DateTime':
    case 'Date':
    case 'Time':
      return b.type === a.type && a.value === (b as typeof a).value;
    case 'Integer':
    case 'Float':
      return b.type === a.type && a.value === (b as typeof a).value;
    case 'Boolean':
      return b.type === 'Boolean' && a.value === b.value;
    case 'Json':
      return (
        b.type === 'Json' &&
        JSON.stringify(a.value) === JSON.stringify(b.value)
      );
    case 'Bytes':
      return (
        b.type === 'Bytes' &&
        a.value.size === b.value.size &&
        a.value.preview === b.value.preview
      );
    case 'Array':
      if (b.type !== 'Array') return false;
      if (a.value.length !== b.value.length) return false;
      return a.value.every((v, i) => compareCellValues(v, b.value[i]));
  }
}
