/**
 * Column windowing math for the horizontally virtualized grid.
 *
 * The rendered columns stay a contiguous slice of `visibleColumns` laid out in
 * normal flex flow, flanked by two spacer divs whose widths stand in for the
 * unmounted columns. Keeping the slice contiguous is what makes the two spacer
 * sums enough to preserve horizontal geometry.
 */
export interface ColumnWindow {
  colStart: number;
  colEnd: number;
  leftSpacerWidth: number;
  rightSpacerWidth: number;
}

export interface ColumnWindowArgs {
  /** Virtualizer visible range (inclusive/exclusive), already overscanned */
  rangeStart: number;
  rangeEnd: number;
  /** Columns that must stay mounted (editing, focused); null = none */
  pinnedVisIdxs: ReadonlyArray<number | null>;
  /** Per-visIdx pixel widths */
  widths: ReadonlyArray<number>;
}

export function computeColumnWindow({ rangeStart, rangeEnd, pinnedVisIdxs, widths }: ColumnWindowArgs): ColumnWindow {
  const count = widths.length;
  if (count === 0) return { colStart: 0, colEnd: 0, leftSpacerWidth: 0, rightSpacerWidth: 0 };

  let colStart = Math.min(Math.max(rangeStart, 0), count);
  let colEnd = Math.min(Math.max(rangeEnd, colStart), count);

  for (const pinned of pinnedVisIdxs) {
    if (pinned == null || pinned < 0 || pinned >= count) continue;
    if (pinned < colStart) colStart = pinned;
    if (pinned + 1 > colEnd) colEnd = pinned + 1;
  }

  let leftSpacerWidth = 0;
  for (let i = 0; i < colStart; i++) leftSpacerWidth += widths[i];
  let rightSpacerWidth = 0;
  for (let i = colEnd; i < count; i++) rightSpacerWidth += widths[i];

  return { colStart, colEnd, leftSpacerWidth, rightSpacerWidth };
}
