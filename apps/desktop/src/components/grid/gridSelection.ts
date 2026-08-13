/**
 * Hybrid cell selection model: one rectangle (anchor+focus) plus explicit
 * ctrl-toggle additions/removals. Drag extension (`extendTo`) is O(1) —
 * no Set materialization on every mouseenter.
 *
 * Invariant: `removed` only ever holds keys inside the current rect;
 * `added` only holds keys outside it. `extendTo` on a selection with
 * non-empty `added`/`removed` resets both to empty — the rectangle wins
 * (matches spreadsheet behavior: shift-drag after ctrl-toggles collapses
 * to the plain rectangle) — otherwise a stale `removed` key left outside
 * the new rect would be counted by `selectionSize` but ignored by
 * `isCellSelected`.
 */

export const cellKey = (row: number, col: number): string => `${row}:${col}`;

export interface CellSelection {
  anchor: { row: number; col: number } | null; // null = empty selection
  focus: { row: number; col: number } | null; // set iff anchor is set
  added: ReadonlySet<string>; // cellKey() cells toggled ON outside the rect
  removed: ReadonlySet<string>; // cellKey() cells toggled OFF inside the rect
}

const NO_CELLS: ReadonlySet<string> = new Set();

export const EMPTY_SELECTION: CellSelection = {
  anchor: null, focus: null, added: NO_CELLS, removed: NO_CELLS,
};

export const isEmpty = (sel: CellSelection): boolean => sel.anchor === null && sel.added.size === 0;

export const selectSingle = (row: number, col: number): CellSelection => ({
  anchor: { row, col }, focus: { row, col }, added: NO_CELLS, removed: NO_CELLS,
});

export const extendTo = (sel: CellSelection, row: number, col: number): CellSelection =>
  sel.anchor === null
    ? selectSingle(row, col)
    : { anchor: sel.anchor, focus: { row, col }, added: NO_CELLS, removed: NO_CELLS };

const inRect = (sel: CellSelection, row: number, col: number): boolean => {
  if (sel.anchor === null || sel.focus === null) return false;
  const minRow = Math.min(sel.anchor.row, sel.focus.row);
  const maxRow = Math.max(sel.anchor.row, sel.focus.row);
  const minCol = Math.min(sel.anchor.col, sel.focus.col);
  const maxCol = Math.max(sel.anchor.col, sel.focus.col);
  return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
};

export const isCellSelected = (sel: CellSelection, row: number, col: number): boolean =>
  inRect(sel, row, col) ? !sel.removed.has(cellKey(row, col)) : sel.added.has(cellKey(row, col));

export function toggleCell(sel: CellSelection, row: number, col: number): CellSelection {
  const key = cellKey(row, col);
  if (inRect(sel, row, col)) {
    const removed = new Set(sel.removed);
    if (removed.has(key)) removed.delete(key); else removed.add(key);
    return { ...sel, removed };
  }
  const added = new Set(sel.added);
  if (added.has(key)) added.delete(key); else added.add(key);
  return { ...sel, added };
}

export function selectionSize(sel: CellSelection): number {
  let size = sel.added.size;
  if (sel.anchor !== null && sel.focus !== null) {
    size += (Math.abs(sel.anchor.row - sel.focus.row) + 1)
          * (Math.abs(sel.anchor.col - sel.focus.col) + 1)
          - sel.removed.size;
  }
  return size;
}

export function materializeCells(sel: CellSelection): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  if (sel.anchor !== null && sel.focus !== null) {
    const minRow = Math.min(sel.anchor.row, sel.focus.row);
    const maxRow = Math.max(sel.anchor.row, sel.focus.row);
    const minCol = Math.min(sel.anchor.col, sel.focus.col);
    const maxCol = Math.max(sel.anchor.col, sel.focus.col);
    for (let row = minRow; row <= maxRow; row++)
      for (let col = minCol; col <= maxCol; col++)
        if (!sel.removed.has(cellKey(row, col))) cells.push({ row, col });
  }
  for (const key of sel.added) {
    const [row, col] = key.split(':').map(Number);
    cells.push({ row, col });
  }
  return cells;
}
