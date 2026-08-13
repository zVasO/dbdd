import { createContext, memo, useContext } from 'react';
import { cn } from '@/lib/utils';
import type { CellValue, ColumnData, ColumnMeta } from '@/lib/types';
import type { CellEdit } from '@/stores/changeStore';
import { editKey, type PendingIndex } from './gridPendingChanges';
import { isCellSelected as isCellInSelection, type CellSelection } from './gridSelection';

/** Build a CellValue from columnar data at a specific position */
export function columnarCellValue(data: ColumnData[], colIdx: number, rowIdx: number): CellValue {
  const col = data[colIdx];
  if (!col) return { type: 'Null' };
  const val = col.values[rowIdx];
  if (val == null) return { type: 'Null' };
  switch (col.kind) {
    case 'Integers': return { type: 'Integer', value: val as number };
    case 'Floats': return { type: 'Float', value: val as number };
    case 'Booleans': return { type: 'Boolean', value: val as boolean };
    case 'Strings': return { type: 'Text', value: val as string };
    case 'Json': return { type: 'Json', value: val };
  }
}

export function formatCell(cell: CellValue): string {
  switch (cell.type) {
    case 'Null':
      return 'NULL';
    case 'Integer':
    case 'Float':
      return String(cell.value);
    case 'Boolean':
      return cell.value ? 'true' : 'false';
    case 'Text':
    case 'DateTime':
    case 'Date':
    case 'Time':
    case 'Uuid':
      return cell.value;
    case 'Json':
      return JSON.stringify(cell.value);
    case 'Bytes':
      return `[${cell.value.size} bytes]`;
    case 'Array':
      return JSON.stringify(cell.value);
    default:
      return '';
  }
}

export type FkMap = Record<string, { refTable: string; refColumn: string; refDb: string | null }>;

/**
 * The body's whole event surface, as one identity-stable object. Every handler
 * reads its indices from `data-vrow` (visual row), `data-arow` (actual row into
 * the columnar data) and `data-col` (unfiltered column index) on the element it
 * is attached to, so no closure is created per row or per cell.
 */
export interface GridBodyHandlers {
  onCellMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  onCellMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onCellContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onCellDoubleClick: (e: React.MouseEvent<HTMLElement>) => void;
  onCellValueClick: (e: React.MouseEvent<HTMLElement>) => void;
  onRowMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onRowContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onRowGutterMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
}

/**
 * The live editor state travels by context rather than by props: it changes on
 * every keystroke, and only the mounted `CellEditor` consumes it, so rows and
 * cells keep their memoized props and never re-render while typing.
 */
export interface GridEditorContextValue {
  value: string;
  isNull: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onToggleNull: () => void;
}

export const GridEditorContext = createContext<GridEditorContextValue | null>(null);

function CellEditor({ nullable }: { nullable: boolean }) {
  const editor = useContext(GridEditorContext);
  if (!editor) return null;

  return (
    <div className="flex h-full w-full items-center bg-background">
      <input
        ref={editor.inputRef}
        className={cn(
          "h-full min-w-0 flex-1 border-none bg-transparent px-2 py-1 outline-none",
          editor.isNull ? 'italic text-muted-foreground' : 'text-foreground'
        )}
        style={{ fontFamily: 'inherit', fontSize: 'inherit' }}
        value={editor.isNull ? '' : editor.value}
        placeholder={editor.isNull ? 'NULL' : ''}
        onChange={editor.onChange}
        onKeyDown={editor.onKeyDown}
        onBlur={editor.onBlur}
      />
      {nullable && (
        <button
          className={cn(
            'shrink-0 px-1 text-[10px] font-mono rounded mr-0.5',
            editor.isNull
              ? 'text-primary font-bold bg-primary/10'
              : 'text-muted-foreground/40 hover:text-muted-foreground'
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={editor.onToggleNull}
          title="Toggle NULL (Ctrl+Shift+N)"
        >
          NULL
        </button>
      )}
    </div>
  );
}

interface GridCellProps {
  virtualIndex: number;
  actualRowIndex: number;
  colIdx: number;
  ariaColIndex: number;
  nullable: boolean;
  width: string;
  columnarData: ColumnData[];
  isEditing: boolean;
  isSelected: boolean;
  isFocused: boolean;
  isHighlighted: boolean;
  isForeignKey: boolean;
  rowDeleted: boolean;
  pendingEdit: CellEdit | undefined;
  handlers: GridBodyHandlers;
}

const GridCell = memo(function GridCell({
  virtualIndex, actualRowIndex, colIdx, ariaColIndex, nullable, width, columnarData,
  isEditing, isSelected, isFocused, isHighlighted, isForeignKey, rowDeleted, pendingEdit, handlers,
}: GridCellProps) {
  const cell = columnarCellValue(columnarData, colIdx, actualRowIndex);

  return (
    <div
      role="gridcell"
      aria-colindex={ariaColIndex}
      data-vrow={virtualIndex}
      data-arow={actualRowIndex}
      data-col={colIdx}
      className={cn(
        'flex shrink-0 items-center border-r border-border/30',
        isEditing && 'ring-2 ring-inset ring-primary',
        !isEditing && isFocused && 'ring-2 ring-primary ring-inset',
        !isEditing && !isFocused && isSelected && 'ring-2 ring-inset ring-primary/60 bg-primary/10',
        pendingEdit && !isEditing && 'bg-yellow-500/15',
        !isEditing && !isFocused && !isSelected && !pendingEdit && isHighlighted && 'bg-primary/8',
      )}
      style={{ width }}
      onMouseDown={handlers.onCellMouseDown}
      onMouseEnter={handlers.onCellMouseEnter}
      onContextMenu={handlers.onCellContextMenu}
      onDoubleClick={handlers.onCellDoubleClick}
    >
      {isEditing ? (
        <CellEditor nullable={nullable} />
      ) : (
        <span
          data-arow={actualRowIndex}
          data-col={colIdx}
          className={cn(
            'truncate px-2 py-1',
            rowDeleted
              ? 'line-through text-muted-foreground'
              : pendingEdit
                ? 'text-yellow-600 dark:text-yellow-400'
                : cell.type === 'Null'
                  ? 'italic text-muted-foreground/50'
                  : cell.type === 'Integer' || cell.type === 'Float'
                    ? 'tabular-nums text-foreground'
                    : cell.type === 'Boolean'
                      ? 'font-medium text-accent-foreground'
                      : isForeignKey
                        ? 'text-blue-600 dark:text-blue-400 underline decoration-dotted cursor-pointer hover:text-blue-700'
                        : 'text-foreground',
          )}
          onClick={handlers.onCellValueClick}
        >
          {pendingEdit && pendingEdit.type === 'edit' ? String(pendingEdit.newValue) : formatCell(cell)}
        </span>
      )}
    </div>
  );
});

interface GridRowProps {
  virtualIndex: number;
  actualRowIndex: number;
  displayIndex: number;
  start: number;
  size: number;
  isOdd: boolean;
  isSelected: boolean;
  rowDeleted: boolean;
  alternatingRowColors: boolean;
  totalWidthStyle: string;
  visibleColumns: ColumnMeta[];
  visibleColIndexMap: number[];
  columnarData: ColumnData[];
  cellSelection: CellSelection;
  pendingIndex: PendingIndex;
  editingCell: { rowIndex: number; colIndex: number } | null;
  focusedCell: { row: number; col: number } | null;
  highlightedColIndex: number | null;
  fkMap: FkMap;
  getColWidthStyle: (colIndex: number) => string;
  handlers: GridBodyHandlers;
}

export const GridRow = memo(function GridRow({
  virtualIndex, actualRowIndex, displayIndex, start, size, isOdd, isSelected, rowDeleted,
  alternatingRowColors, totalWidthStyle, visibleColumns, visibleColIndexMap, columnarData,
  cellSelection, pendingIndex, editingCell, focusedCell, highlightedColIndex, fkMap,
  getColWidthStyle, handlers,
}: GridRowProps) {
  return (
    <div
      role="row"
      aria-rowindex={displayIndex + 2}
      data-vrow={virtualIndex}
      data-arow={actualRowIndex}
      className={cn(
        'absolute left-0 top-0 flex cursor-pointer border-b border-border/30',
        rowDeleted
          ? 'opacity-40'
          : isSelected
            ? 'bg-primary/15 hover:bg-primary/20'
            : isOdd && alternatingRowColors
              ? 'bg-muted/30 hover:bg-muted/40'
              : 'hover:bg-muted/30',
      )}
      style={{
        height: `${size}px`,
        transform: `translateY(${start}px)`,
        minWidth: totalWidthStyle,
      }}
      onMouseEnter={handlers.onRowMouseEnter}
      onContextMenu={handlers.onRowContextMenu}
    >
      {/* Row number (click to select row) */}
      <div
        data-vrow={virtualIndex}
        className={cn(
          'flex w-[50px] shrink-0 items-center justify-center border-r border-border/30 text-[10px] cursor-pointer',
          isSelected ? 'font-semibold text-primary' : 'text-muted-foreground',
          rowDeleted && 'line-through',
        )}
        onMouseDown={handlers.onRowGutterMouseDown}
      >
        {displayIndex + 1}
      </div>

      {/* Cells */}
      {visibleColumns.map((col, visIdx) => {
        const colIdx = visibleColIndexMap[visIdx];
        return (
          <GridCell
            key={colIdx}
            virtualIndex={virtualIndex}
            actualRowIndex={actualRowIndex}
            colIdx={colIdx}
            ariaColIndex={visIdx + 1}
            nullable={col.nullable}
            width={getColWidthStyle(colIdx)}
            columnarData={columnarData}
            isEditing={editingCell?.rowIndex === virtualIndex && editingCell?.colIndex === colIdx}
            isSelected={isCellInSelection(cellSelection, virtualIndex, colIdx)}
            isFocused={focusedCell?.row === virtualIndex && focusedCell?.col === colIdx}
            isHighlighted={highlightedColIndex === colIdx}
            isForeignKey={Boolean(fkMap[col.name])}
            rowDeleted={rowDeleted}
            pendingEdit={pendingIndex.edits.get(editKey(actualRowIndex, col.name))}
            handlers={handlers}
          />
        );
      })}
    </div>
  );
});
