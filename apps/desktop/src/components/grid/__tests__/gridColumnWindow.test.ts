import { describe, it, expect } from 'vitest';
import { computeColumnWindow } from '../gridColumnWindow';

const widths = (n: number, w = 150) => Array.from({ length: n }, () => w);

describe('computeColumnWindow', () => {
  it('windows the virtualizer range and sums spacers from the outside widths', () => {
    const w = computeColumnWindow({ rangeStart: 4, rangeEnd: 8, pinnedVisIdxs: [null, null], widths: widths(20) });
    expect(w).toEqual({ colStart: 4, colEnd: 8, leftSpacerWidth: 4 * 150, rightSpacerWidth: 12 * 150 });
  });

  it('extends the window to include a pinned column before the range', () => {
    const w = computeColumnWindow({ rangeStart: 10, rangeEnd: 14, pinnedVisIdxs: [2, null], widths: widths(20) });
    expect(w.colStart).toBe(2);
    expect(w.colEnd).toBe(14);
    expect(w.leftSpacerWidth).toBe(2 * 150);
  });

  it('extends the window to include a pinned column after the range', () => {
    const w = computeColumnWindow({ rangeStart: 0, rangeEnd: 4, pinnedVisIdxs: [null, 17], widths: widths(20) });
    expect(w.colEnd).toBe(18);
    expect(w.rightSpacerWidth).toBe(2 * 150);
  });

  it('clamps to the column count and handles empty', () => {
    expect(computeColumnWindow({ rangeStart: 0, rangeEnd: 99, pinnedVisIdxs: [null, null], widths: widths(5) }))
      .toEqual({ colStart: 0, colEnd: 5, leftSpacerWidth: 0, rightSpacerWidth: 0 });
    expect(computeColumnWindow({ rangeStart: 0, rangeEnd: 0, pinnedVisIdxs: [null, null], widths: [] }))
      .toEqual({ colStart: 0, colEnd: 0, leftSpacerWidth: 0, rightSpacerWidth: 0 });
  });

  it('uses per-column widths, not a uniform size', () => {
    const w = computeColumnWindow({ rangeStart: 1, rangeEnd: 3, pinnedVisIdxs: [null, null], widths: [100, 200, 300, 400] });
    expect(w.leftSpacerWidth).toBe(100);
    expect(w.rightSpacerWidth).toBe(400);
  });
});
