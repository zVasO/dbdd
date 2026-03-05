import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { DiffCell, compareCellValues, type DiffStatus } from '@/components/diff/DiffCell';
import type { QueryResult, CellValue } from '@/lib/types';

interface DataDiffViewProps {
  leftResult: QueryResult;
  rightResult: QueryResult;
  leftLabel?: string;
  rightLabel?: string;
}

interface DiffRowData {
  index: number;
  status: DiffStatus;
  cells: Array<{
    left: CellValue | null;
    right: CellValue | null;
    status: DiffStatus;
  }>;
}

interface DiffSummary {
  changed: number;
  added: number;
  removed: number;
  unchanged: number;
}

export function DataDiffView({
  leftResult,
  rightResult,
  leftLabel = 'Left',
  rightLabel = 'Right',
}: DataDiffViewProps) {
  const { rows, columns, summary } = useMemo(() => {
    // Build unified column list (union of both sides, preserving order)
    const leftCols = leftResult.columns.map((c) => c.name);
    const rightCols = rightResult.columns.map((c) => c.name);
    const allColumns: string[] = [...leftCols];
    for (const col of rightCols) {
      if (!allColumns.includes(col)) {
        allColumns.push(col);
      }
    }

    const leftColIndex = new Map(leftCols.map((c, i) => [c, i]));
    const rightColIndex = new Map(rightCols.map((c, i) => [c, i]));

    const maxRows = Math.max(leftResult.rows.length, rightResult.rows.length);
    const diffRows: DiffRowData[] = [];
    const diffSummary: DiffSummary = {
      changed: 0,
      added: 0,
      removed: 0,
      unchanged: 0,
    };

    for (let rowIdx = 0; rowIdx < maxRows; rowIdx++) {
      const leftRow = rowIdx < leftResult.rows.length ? leftResult.rows[rowIdx] : null;
      const rightRow = rowIdx < rightResult.rows.length ? rightResult.rows[rowIdx] : null;

      let rowStatus: DiffStatus = 'unchanged';

      if (leftRow && !rightRow) {
        rowStatus = 'removed';
        diffSummary.removed++;
      } else if (!leftRow && rightRow) {
        rowStatus = 'added';
        diffSummary.added++;
      }

      const cells = allColumns.map((colName) => {
        const leftColIdx = leftColIndex.get(colName);
        const rightColIdx = rightColIndex.get(colName);

        const leftCell =
          leftRow && leftColIdx !== undefined ? leftRow.cells[leftColIdx] : null;
        const rightCell =
          rightRow && rightColIdx !== undefined ? rightRow.cells[rightColIdx] : null;

        let cellStatus: DiffStatus;
        if (rowStatus === 'added') {
          cellStatus = 'added';
        } else if (rowStatus === 'removed') {
          cellStatus = 'removed';
        } else if (compareCellValues(leftCell, rightCell)) {
          cellStatus = 'unchanged';
        } else {
          cellStatus = 'changed';
        }

        return { left: leftCell, right: rightCell, status: cellStatus };
      });

      if (
        rowStatus === 'unchanged' &&
        cells.some((c) => c.status === 'changed')
      ) {
        rowStatus = 'changed';
        diffSummary.changed++;
      } else if (rowStatus === 'unchanged') {
        diffSummary.unchanged++;
      }

      diffRows.push({ index: rowIdx, status: rowStatus, cells });
    }

    return { rows: diffRows, columns: allColumns, summary: diffSummary };
  }, [leftResult, rightResult]);

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b flex-wrap">
        <span className="text-sm font-medium text-muted-foreground">Diff Summary:</span>
        {summary.changed > 0 && (
          <Badge variant="secondary" className="text-yellow-600 dark:text-yellow-400 text-xs">
            {summary.changed} changed
          </Badge>
        )}
        {summary.added > 0 && (
          <Badge variant="secondary" className="text-green-600 dark:text-green-400 text-xs">
            {summary.added} added
          </Badge>
        )}
        {summary.removed > 0 && (
          <Badge variant="secondary" className="text-red-600 dark:text-red-400 text-xs">
            {summary.removed} removed
          </Badge>
        )}
        {summary.unchanged > 0 && (
          <Badge variant="secondary" className="text-xs">
            {summary.unchanged} unchanged
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {leftResult.rows.length} rows vs {rightResult.rows.length} rows
        </span>
      </div>

      {/* Column headers */}
      <div className="border-b bg-muted/30">
        <div className="flex">
          {/* Row number column */}
          <div className="w-10 shrink-0 px-1 py-1.5 text-xs font-medium text-muted-foreground text-center border-r">
            #
          </div>

          {/* Columns */}
          {columns.map((col) => (
            <div key={col} className="flex flex-1 min-w-0">
              <div className="flex-1 px-2 py-1.5 text-xs font-medium truncate border-r">
                <span className="text-muted-foreground">{leftLabel}:</span>{' '}
                {col}
              </div>
              <div className="flex-1 px-2 py-1.5 text-xs font-medium truncate">
                <span className="text-muted-foreground">{rightLabel}:</span>{' '}
                {col}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rows */}
      <ScrollArea className="flex-1">
        <div>
          {rows.map((row) => (
            <div
              key={row.index}
              className={cn(
                'flex border-b hover:bg-muted/20',
                row.status === 'added' && 'bg-green-500/5',
                row.status === 'removed' && 'bg-red-500/5',
                row.status === 'changed' && 'bg-yellow-500/5',
              )}
            >
              {/* Row number */}
              <div className="w-10 shrink-0 px-1 py-1 text-xs text-muted-foreground text-center border-r font-mono">
                {row.index + 1}
              </div>

              {/* Cells */}
              {row.cells.map((cell, cellIdx) => (
                <div key={cellIdx} className="flex-1 min-w-0">
                  <DiffCell
                    left={cell.left}
                    right={cell.right}
                    status={cell.status}
                  />
                </div>
              ))}
            </div>
          ))}

          {rows.length === 0 && (
            <div className="text-muted-foreground text-sm text-center py-8">
              No rows to compare
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
