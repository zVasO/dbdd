import { describe, it, expect } from 'vitest';
import {
  EMPTY_SELECTION, selectSingle, extendTo, toggleCell,
  isCellSelected, selectionSize, materializeCells, isEmpty,
} from '../gridSelection';

describe('gridSelection', () => {
  it('selectSingle selects exactly one cell', () => {
    const s = selectSingle(2, 3);
    expect(isCellSelected(s, 2, 3)).toBe(true);
    expect(isCellSelected(s, 2, 4)).toBe(false);
    expect(selectionSize(s)).toBe(1);
  });

  it('extendTo grows a rectangle in O(1) and covers the whole rect', () => {
    const s = extendTo(selectSingle(1, 1), 3, 2);
    expect(selectionSize(s)).toBe(3 * 2);
    expect(isCellSelected(s, 2, 2)).toBe(true);
    expect(isCellSelected(s, 0, 1)).toBe(false);
  });

  it('extendTo keeps the anchor when dragged past it (inverted rect)', () => {
    const s = extendTo(selectSingle(5, 5), 3, 3);
    expect(isCellSelected(s, 4, 4)).toBe(true);
    expect(isCellSelected(s, 5, 5)).toBe(true);
    expect(selectionSize(s)).toBe(9);
  });

  it('re-extending replaces the focus, not accumulating area', () => {
    const s1 = extendTo(selectSingle(0, 0), 9, 9);
    const s2 = extendTo(s1, 1, 1);
    expect(selectionSize(s2)).toBe(4);
    expect(isCellSelected(s2, 5, 5)).toBe(false);
  });

  it('toggleCell outside the rect adds; toggling again removes', () => {
    const base = extendTo(selectSingle(0, 0), 1, 1);
    const plus = toggleCell(base, 8, 8);
    expect(isCellSelected(plus, 8, 8)).toBe(true);
    expect(selectionSize(plus)).toBe(5);
    const minus = toggleCell(plus, 8, 8);
    expect(isCellSelected(minus, 8, 8)).toBe(false);
    expect(selectionSize(minus)).toBe(4);
  });

  it('toggleCell inside the rect subtracts; toggling again restores', () => {
    const base = extendTo(selectSingle(0, 0), 1, 1);
    const holed = toggleCell(base, 0, 1);
    expect(isCellSelected(holed, 0, 1)).toBe(false);
    expect(selectionSize(holed)).toBe(3);
    const restored = toggleCell(holed, 0, 1);
    expect(isCellSelected(restored, 0, 1)).toBe(true);
    expect(selectionSize(restored)).toBe(4);
  });

  it('materializeCells is row-major over the rect minus holes plus additions', () => {
    const sel = toggleCell(toggleCell(extendTo(selectSingle(0, 0), 1, 1), 1, 0), 5, 5);
    expect(materializeCells(sel)).toEqual([
      { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 1 }, { row: 5, col: 5 },
    ]);
  });

  it('isEmpty on EMPTY_SELECTION and after extendTo from empty', () => {
    expect(isEmpty(EMPTY_SELECTION)).toBe(true);
    const s = extendTo(EMPTY_SELECTION, 2, 2);
    expect(isEmpty(s)).toBe(false);
    expect(selectionSize(s)).toBe(1);
  });

  it('extendTo drops prior toggles (rect wins)', () => {
    const sel = extendTo(toggleCell(extendTo(selectSingle(0, 0), 1, 1), 5, 5), 2, 2);
    expect(selectionSize(sel)).toBe(9);
    expect(isCellSelected(sel, 5, 5)).toBe(false);
  });
});
