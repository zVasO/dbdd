# Perf Wave 3 — Grid Memo Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `memo(DataGrid)` actually hold and make per-frame grid work O(visible), so scrolling, drag-selection and bulk editing stay fluid on large results.

**Architecture:** Five tasks in two independent chains. Chain A (Tasks 1→2) stabilizes everything PanelLayout passes to DataGrid: a `_activeResultCache` in resultStore (mirroring the existing `_rowsCache` precedent) plus stable handler identities in PanelLayout. Chain B (Tasks 3→4→5) makes DataGrid's inner loops cheap: an indexed view of pending changes (Map/Set instead of per-cell `.find()`), a rectangle-based selection model (O(1) drag instead of O(area) Set rebuilds), then extraction of memoized `GridRow`/`GridCell` components. Pure logic goes in standalone modules with vitest coverage; component wiring is verified by typecheck + build + review (no jsdom infra exists — documented gap, out of scope).

**Tech Stack:** React 19, Zustand 5, @tanstack/react-virtual, vitest 2 (node env, pure functions only), TypeScript strict.

## Global Constraints

- All verification commands must pass at the end of every task, run from `apps/desktop`: `npx tsc --noEmit`, `npx vitest run`, `pnpm --filter desktop build:frontend` (from repo root for the last one). Rust untouched by this wave — do not run cargo unless you touched Rust.
- Work directly on `master`. After each task's final commit, `git push origin master`. If the push is rejected, `git fetch origin && git rebase origin/master` then push.
- Every commit message ends with the two trailers, exactly:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01CVerLtPhHhQbDjA6p7ZMaG`
- Surgical diffs: do not reformat, rename, or "improve" code outside the task's stated scope. No comments explaining what changed — comments only for constraints the code can't show.
- Behavior parity is the default. The ONE accepted behavior change is in Task 4 (shift-selection becomes pure rectangle extension, spreadsheet-style) and is called out there; anything else that changes user-visible behavior is a bug.
- Index spaces (critical, source of subtle bugs): `selectedRows`, `selectedCells`, `focusedCell`, `editingCell.rowIndex`, `contextMenu.rowIndex` key on the **visual/paginated** index (`virtualRow.index`). `pendingChanges[].rowIndex`, `isRowDeleted`, `getCellPendingEdit`, `columnarCellValue` key on the **actual** index (`paginatedIndexMap[virtualRow.index]`). Column keys are always the unfiltered `colIdx` (`visibleColIndexMap[visIdx]`), never `visIdx`. Preserve this exactly.

---

### Task 1: `_activeResultCache` in resultStore

`getActiveResult()` (resultStore.ts:723-738) fabricates a fresh object (and a fresh `rows: []`) on every call, and PanelLayout calls it during render — this alone defeats `memo(DataGrid)`. Cache the derived object following the existing `_rowsCache`/`_allResultsCache` precedent (fields at resultStore.ts:41-42; populate-on-read pattern in `getRows` :682-701).

**Files:**
- Modify: `apps/desktop/src/stores/resultStore.ts`
- Test: `apps/desktop/src/stores/__tests__/resultStore.activeResult.test.ts` (create)

**Interfaces:**
- Consumes: existing `TabResult` shape, `getActiveResult(tabId): QueryResult | null`.
- Produces: `getActiveResult` with **stable identity** — repeated calls return the same object until `data`, `activeResultIndex`, or the result set changes. Task 2 relies on this. Signature unchanged.

- [ ] **Step 1: Write the failing tests**

Create `apps/desktop/src/stores/__tests__/resultStore.activeResult.test.ts`. Model the setup on the existing `resultStore.initStream.test.ts` (same store import/reset idiom — read it first and copy its beforeEach reset). Test cases:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useResultStore } from '../resultStore';

// Build a minimal ColumnarResult the same way resultStore.initStream.test.ts does;
// adjust field names to the real type (columns, data, row_count, query_id, ...).
const columnar = (queryId: string) => ({
  query_id: queryId,
  columns: [{ name: 'id', data_type: 'int4', nullable: false }],
  data: [{ type: 'Integers', values: [1], nulls: [] }],
  row_count: 1,
  affected_rows: null,
  execution_time_ms: 1,
  warnings: [],
  result_type: 'Select',
});

describe('getActiveResult identity', () => {
  beforeEach(() => {
    useResultStore.setState({ results: {} }); // mirror initStream.test.ts reset
  });

  it('returns the same object across calls when nothing changed', () => {
    useResultStore.getState().setColumnarResult('tab1', columnar('q1') as never);
    const a = useResultStore.getState().getActiveResult('tab1');
    const b = useResultStore.getState().getActiveResult('tab1');
    expect(a).not.toBeNull();
    expect(b).toBe(a); // identity, not equality
  });

  it('returns a fresh object after setActiveResultIndex', () => {
    useResultStore.getState().setColumnarResults('tab1', [columnar('q1'), columnar('q2')] as never);
    const a = useResultStore.getState().getActiveResult('tab1');
    useResultStore.getState().setActiveResultIndex('tab1', 1);
    const b = useResultStore.getState().getActiveResult('tab1');
    expect(b).not.toBe(a);
    expect(b?.query_id).toBe('q2');
  });

  it('returns a fresh object after a new result replaces the old one', () => {
    useResultStore.getState().setColumnarResult('tab1', columnar('q1') as never);
    const a = useResultStore.getState().getActiveResult('tab1');
    useResultStore.getState().setColumnarResult('tab1', columnar('q2') as never);
    const b = useResultStore.getState().getActiveResult('tab1');
    expect(b).not.toBe(a);
    expect(b?.query_id).toBe('q2');
  });

  it('still returns null for unknown tab / missing columnar', () => {
    expect(useResultStore.getState().getActiveResult('nope')).toBeNull();
  });
});
```

Adapt the `columnar()` literal to the real `ColumnarResult` type (check `initStream.test.ts` / the type import) — the shape above is indicative, the assertions are the requirement.

- [ ] **Step 2: Run tests, verify the identity test fails**

Run: `npx vitest run src/stores/__tests__/resultStore.activeResult.test.ts`
Expected: identity tests FAIL (`b` is a new object each call today); null test passes.

- [ ] **Step 3: Implement the cache**

In `resultStore.ts`:
1. Add field to `TabResult` next to `_rowsCache`/`_allResultsCache` (~:41-42): `_activeResultCache: QueryResult | null;`
2. In `getActiveResult` (:723-738): if `current._activeResultCache` is set, return it; otherwise build the object exactly as today, then write it back exactly like `getRows` does (:682-701): `set()` merging `{ ...current, _activeResultCache: built }` into `results[tabId]`, and return `built`.
3. Set `_activeResultCache: null` at **all 11 writer touch points** where `_rowsCache` is reset/assigned — same statements, currently at :301 (trackAndEvict), :362 (setExecuting), :392 (setResult), :421 (setResults), :448 (setColumnarResult), :475 (setColumnarResults), :499 (setError), :546 (setActiveResultIndex), :583 (initStream), :623 (appendChunk), :672 (finishStream). Unlike `_rowsCache` (which sometimes gets a value), `_activeResultCache` is always reset to `null`; it repopulates on next read. Grep `_rowsCache` to make sure you found every site — line numbers may have drifted.

- [ ] **Step 4: Run the new tests and the whole suite**

Run: `npx vitest run`
Expected: all pass, including the 3 existing initStream tests.

- [ ] **Step 5: Typecheck, build, commit, push**

Run: `npx tsc --noEmit` then `pnpm --filter desktop build:frontend` (repo root).

```bash
git add apps/desktop/src/stores/resultStore.ts apps/desktop/src/stores/__tests__/resultStore.activeResult.test.ts
git commit -m "perf: cache getActiveResult so its identity is render-stable"
git push origin master
```
(Trailers per Global Constraints.)

---

### Task 2: Stabilize every prop PanelLayout passes to DataGrid

`memo(DataGrid)` (DataGrid.tsx:228) is defeated by **four** unstable props from PanelLayout (not two as the original audit said): `result` (fixed by Task 1), `onHighlightDone` (inline closure, PanelLayout.tsx:492), and `onServerSort`/`onServerPageChange` (`handleServerSort` :150-155 and `handleServerPageChange` :184-211 both depend on the `activeTab` object — new identity whenever queryStore replaces the tab — and on `currentSql` via `buildTableSql` :137-148, so they churn on every editor keystroke).

**Files:**
- Modify: `apps/desktop/src/components/layout/PanelLayout.tsx`

**Interfaces:**
- Consumes: Task 1's identity-stable `getActiveResult`.
- Produces: every prop passed to `<DataGrid>` at PanelLayout.tsx:483-493 identity-stable across renders while the active tab and its result are unchanged. No signature changes to DataGrid.

- [ ] **Step 1: Make `handleServerSort` / `handleServerPageChange` / `buildTableSql` identity-stable**

Rewrite them to read volatile state at call time instead of closing over it. Pattern (adapt to the real bodies — read them first):

```tsx
const buildTableSql = useCallback((/* existing params */) => {
  const { activeTabId, tabs } = useQueryStore.getState();
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;
  // ...existing logic, using `tab` and store-read sql instead of captured
  // `activeTab` / `currentSql`
}, []); // deps: only truly stable values (store hooks, setters)
```

Apply the same to `handleServerSort` and `handleServerPageChange`. Deps arrays must end up containing only stable identities (Zustand actions are stable; primitives like `connection?.id` are acceptable). The behavior contract: these handlers fire on user gestures (sort click, page change), so reading the *current* active tab at fire time is equivalent to the captured one — the grid showing the tab is the active tab.

Keep the existing `tab.table ? onServerSort : undefined` gating at the call site — with a stable handler the ternary result is stable per tab.

- [ ] **Step 2: Make `onHighlightDone` identity-stable per tab**

Replace the inline closure at :492. `renderResult` is a plain function outside the hook scope, so hoist into the component body, keyed on the active tab id so identity survives re-renders of the same tab:

```tsx
const activeTabIdForHighlight = activeTab?.id;
const handleHighlightDone = useMemo(() => {
  if (!activeTabIdForHighlight) return undefined;
  return () => useQueryStore.getState().setHighlightedColumn(activeTabIdForHighlight, null);
}, [activeTabIdForHighlight]);
```

Pass `onHighlightDone={handleHighlightDone}` at the DataGrid call site(s). Note `renderResult` is invoked from two branches (:380 and :445) — both render paths must use the hoisted handler.

- [ ] **Step 3: Sanity-check the remaining DataGrid props**

At :483-493 confirm each prop is now stable while tab+result are unchanged: `result` (Task 1 cache), `database`/`table`/`highlightedColumnName` (strings off the tab), `serverTotalRows`/`serverPage` (numbers), the three handlers (steps 1-2). If you find another unstable prop, stabilize it the same way and say so in your report.

- [ ] **Step 4: Verify**

Run from `apps/desktop`: `npx tsc --noEmit && npx vitest run`, then `pnpm --filter desktop build:frontend` from root.
Expected: all green. There is no DOM test infra; the reviewer verifies stability by reading the deps arrays.

- [ ] **Step 5: Commit, push**

```bash
git add apps/desktop/src/components/layout/PanelLayout.tsx
git commit -m "perf: stabilize DataGrid prop identities in PanelLayout"
git push origin master
```

---

### Task 3: Indexed pending changes (`gridPendingChanges.ts`)

Per-cell `getCellPendingEdit` is a linear `.find()` over `pendingChanges` (DataGrid.tsx:415-419), per-row `isRowDeleted` a `.some()` (:421-423), and `insertedRows` (:441) is an unmemoized `.filter()` — O(cells × changes) per render during bulk edits. Build the three indexes once per `pendingChanges` identity (the `useShallow` subscription at :304-311 keeps that identity stable across unrelated store writes).

**Files:**
- Create: `apps/desktop/src/components/grid/gridPendingChanges.ts`
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx` (:415-423, :441 and consumers :1488, :1540, :1674)
- Test: `apps/desktop/src/components/grid/__tests__/gridPendingChanges.test.ts` (create)

**Interfaces:**
- Consumes: `Change`, `CellEdit`, `RowInsert` types from `@/stores/changeStore` (verify the exact exported names in changeStore.ts:10-43 before importing).
- Produces (Task 5 consumes these exact names):
  ```ts
  export const editKey: (rowIndex: number, column: string) => string; // `${rowIndex}:${column}`
  export interface PendingIndex {
    edits: Map<string, CellEdit>;   // first matching edit wins, mirroring .find()
    deletedRows: Set<number>;       // actual row indexes with a type:'delete' change
    inserts: RowInsert[];           // type:'insert' changes, in original order
  }
  export function buildPendingIndex(pending: readonly Change[]): PendingIndex;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildPendingIndex, editKey } from '../gridPendingChanges';
import type { Change } from '@/stores/changeStore';

const edit = (rowIndex: number, column: string, newValue: unknown): Change =>
  ({ type: 'edit', id: `e${rowIndex}${column}`, connectionId: 'c', table: 't',
     database: 'd', rowIndex, primaryKeys: {}, column, oldValue: null, newValue } as Change);
const del = (rowIndex: number): Change =>
  ({ type: 'delete', id: `d${rowIndex}`, connectionId: 'c', table: 't',
     database: 'd', rowIndex, primaryKeys: {}, originalRow: {} } as Change);
const ins = (id: string): Change =>
  ({ type: 'insert', id, connectionId: 'c', table: 't', database: 'd', values: {} } as never);

describe('buildPendingIndex', () => {
  it('indexes edits by row:column', () => {
    const idx = buildPendingIndex([edit(3, 'name', 'x'), del(5)]);
    expect(idx.edits.get(editKey(3, 'name'))?.newValue).toBe('x');
    expect(idx.edits.get(editKey(3, 'other'))).toBeUndefined();
  });

  it('keeps the FIRST edit for a cell, mirroring Array.find', () => {
    const idx = buildPendingIndex([edit(1, 'a', 'first'), edit(1, 'a', 'second')]);
    expect(idx.edits.get(editKey(1, 'a'))?.newValue).toBe('first');
  });

  it('collects deleted row indexes', () => {
    const idx = buildPendingIndex([del(2), del(7), edit(2, 'a', 1)]);
    expect(idx.deletedRows.has(2)).toBe(true);
    expect(idx.deletedRows.has(7)).toBe(true);
    expect(idx.deletedRows.has(3)).toBe(false);
  });

  it('collects inserts in order', () => {
    const idx = buildPendingIndex([ins('i1'), del(1), ins('i2')]);
    expect(idx.inserts.map((i) => i.id)).toEqual(['i1', 'i2']);
  });

  it('returns empty indexes for an empty list', () => {
    const idx = buildPendingIndex([]);
    expect(idx.edits.size).toBe(0);
    expect(idx.deletedRows.size).toBe(0);
    expect(idx.inserts).toEqual([]);
  });
});
```

Adjust the literal builders to satisfy the real `Change` union — the casts keep the test honest about which fields matter. **Before writing:** check changeStore's `addChange` semantics; if it already replaces an existing edit for the same cell (i.e. duplicates can't occur), keep the first-wins test anyway — it pins the `.find()` parity contract.

- [ ] **Step 2: Run, verify failure**

Run: `npx vitest run src/components/grid/__tests__/gridPendingChanges.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
import type { CellEdit, Change, RowInsert } from '@/stores/changeStore';

export const editKey = (rowIndex: number, column: string) => `${rowIndex}:${column}`;

export interface PendingIndex {
  edits: Map<string, CellEdit>;
  deletedRows: Set<number>;
  inserts: RowInsert[];
}

export function buildPendingIndex(pending: readonly Change[]): PendingIndex {
  const edits = new Map<string, CellEdit>();
  const deletedRows = new Set<number>();
  const inserts: RowInsert[] = [];
  for (const change of pending) {
    if (change.type === 'edit') {
      const key = editKey(change.rowIndex, change.column);
      if (!edits.has(key)) edits.set(key, change);
    } else if (change.type === 'delete') {
      deletedRows.add(change.rowIndex);
    } else if (change.type === 'insert') {
      inserts.push(change);
    }
  }
  return { edits, deletedRows, inserts };
}
```

(If the type names differ in changeStore, use the real ones and keep the shape.)

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run src/components/grid/__tests__/gridPendingChanges.test.ts` — PASS.

- [ ] **Step 5: Wire DataGrid to the index**

In DataGrid.tsx:
```tsx
const pendingIndex = useMemo(() => buildPendingIndex(pendingChanges), [pendingChanges]);
```
- `getCellPendingEdit` (:415-419) → `useCallback((rowIndex: number, colName: string) => pendingIndex.edits.get(editKey(rowIndex, colName)), [pendingIndex])` — or inline the `.get` at the call site (:1540) and delete the helper; prefer whichever leaves fewer indirections but do NOT change what the consumers receive (`CellEdit | undefined`).
- `isRowDeleted` (:421-423) → `pendingIndex.deletedRows.has(rowIndex)` (same choice).
- `insertedRows` (:441) → `pendingIndex.inserts` (delete the unmemoized `.filter`); consumer at :1674 unchanged.

- [ ] **Step 6: Full verification, commit, push**

`npx tsc --noEmit && npx vitest run`, root `pnpm --filter desktop build:frontend`.

```bash
git add apps/desktop/src/components/grid/gridPendingChanges.ts apps/desktop/src/components/grid/__tests__/gridPendingChanges.test.ts apps/desktop/src/components/grid/DataGrid.tsx
git commit -m "perf: index pending grid changes instead of per-cell linear scans"
git push origin master
```

---

### Task 4: Rectangle-based selection model (`gridSelection.ts`)

Drag-selection rebuilds a `Set<string>` covering the whole rectangle on **every mouseenter** (DataGrid.tsx:892-909) — 10 000 allocations per mouse event on a 500×20 drag — and every cell render does `selectedCells.has(cellKey(...))` with a fresh template string (:1542). Replace `Set<string>` with a hybrid model: one rectangle (anchor+focus) plus explicit ctrl-toggle additions/removals, so drag extension is O(1).

**Accepted behavior change (the only one in this wave):** shift-based range gestures (shift-click :857-869, shift-arrow :1246/:1263, shift-key nav :1171-1175) become pure rectangle extension from the anchor — standard spreadsheet semantics. Today shift-arrow *accumulates* a union of rectangles; that union is no longer expressible. Ctrl/meta single-cell toggles (:870-878) keep exact behavior via the added/removed sets.

**Files:**
- Create: `apps/desktop/src/components/grid/gridSelection.ts`
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx` (state :252-253, handlers :838-909, keyboard :1171-1263, all 19 consumers — full list in steps)
- Test: `apps/desktop/src/components/grid/__tests__/gridSelection.test.ts` (create)

**Interfaces:**
- Produces (Task 5 consumes `isCellSelected` and `CellSelection`):
  ```ts
  export interface CellSelection {
    anchor: { row: number; col: number } | null; // null = empty selection
    focus: { row: number; col: number } | null;  // set iff anchor is set
    added: ReadonlySet<string>;   // cellKey() cells toggled ON outside the rect
    removed: ReadonlySet<string>; // cellKey() cells toggled OFF inside the rect
  }
  export const EMPTY_SELECTION: CellSelection;
  export function selectSingle(row: number, col: number): CellSelection;
  export function extendTo(sel: CellSelection, row: number, col: number): CellSelection; // O(1): moves focus, keeps anchor; on empty selection behaves like selectSingle
  export function toggleCell(sel: CellSelection, row: number, col: number): CellSelection;
  export function isCellSelected(sel: CellSelection, row: number, col: number): boolean;
  export function selectionSize(sel: CellSelection): number; // O(added+removed), no materialization
  export function materializeCells(sel: CellSelection): Array<{ row: number; col: number }>; // row-major order (rows ascending, cols ascending, then `added` in insertion order) — copy/TSV layout depends on this
  export function isEmpty(sel: CellSelection): boolean;
  export const cellKey: (row: number, col: number) => string; // move the existing :64 helper here (same format "row:col"), re-export or update importers
  ```

- [ ] **Step 1: Write the failing tests**

```ts
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
});
```

- [ ] **Step 2: Run, verify failure** — `npx vitest run src/components/grid/__tests__/gridSelection.test.ts` → module not found.

- [ ] **Step 3: Implement the module**

```ts
export const cellKey = (row: number, col: number) => `${row}:${col}`;

export interface CellSelection {
  anchor: { row: number; col: number } | null;
  focus: { row: number; col: number } | null;
  added: ReadonlySet<string>;
  removed: ReadonlySet<string>;
}

const NO_CELLS: ReadonlySet<string> = new Set();

export const EMPTY_SELECTION: CellSelection = {
  anchor: null, focus: null, added: NO_CELLS, removed: NO_CELLS,
};

export const isEmpty = (sel: CellSelection) => sel.anchor === null && sel.added.size === 0;

export const selectSingle = (row: number, col: number): CellSelection => ({
  anchor: { row, col }, focus: { row, col }, added: NO_CELLS, removed: NO_CELLS,
});

export const extendTo = (sel: CellSelection, row: number, col: number): CellSelection =>
  sel.anchor === null
    ? selectSingle(row, col)
    : { anchor: sel.anchor, focus: { row, col }, added: sel.added, removed: sel.removed };

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
```

Invariant to keep (document it in the module doc comment): `removed` only ever holds keys inside the current rect, `added` only keys outside it. `extendTo` moving the focus can break that invariant for stale toggles — acceptable: `isCellSelected` and `selectionSize` stay consistent with each other because a stale `removed` key outside the new rect is ignored by `isCellSelected`… **it is not** ignored by `selectionSize`. To keep them consistent, `extendTo` on a selection with non-empty `added`/`removed` must reset both to `NO_CELLS` (shift-drag after ctrl-toggles collapses to the plain rectangle — matching spreadsheet behavior). Implement that reset and add a test for it:

```ts
it('extendTo drops prior toggles (rect wins)', () => {
  const sel = extendTo(toggleCell(extendTo(selectSingle(0, 0), 1, 1), 5, 5), 2, 2);
  expect(selectionSize(sel)).toBe(9);
  expect(isCellSelected(sel, 5, 5)).toBe(false);
});
```

- [ ] **Step 4: Run tests, verify pass** — all gridSelection tests PASS.

- [ ] **Step 5: Rewire DataGrid**

Replace `selectedCells: Set<string>` (:252) with `cellSelection: CellSelection` (init `EMPTY_SELECTION`). Keep `lastSelectedCellKey`/`cellDragStart` only if still needed — anchor subsumes `cellDragStart`; delete what becomes redundant. Rewire every consumer (current lines, may drift — grep `selectedCells` and `setSelectedCells` until none remain):
- :838-889 `handleCellMouseDown`: shift → `extendTo` from existing selection; ctrl/meta → `toggleCell`; plain → `selectSingle` + drag ref.
- :892-909 `handleCellMouseEnter`: `setCellSelection((sel) => extendTo(sel, rowIndex, colIndex))` — the whole point: no loop, no Set.
- :1027-1053 `copySelection`, :1072-1075 / :1078-1085 context extractors: `materializeCells`.
- :1217, :1257, :1514, :1565, :1567, :1742-1749, :1858, :1864-1900: `.size` → `selectionSize`, `.has(...)` → `isCellSelected`, `.size === 0` → `isEmpty`.
- :1542 per-cell read → `isCellSelected(cellSelection, virtualRow.index, colIdx)` (no string allocation on the rect path).
- Keyboard shift-nav (:1171-1175, :1246, :1263) → `extendTo`.
Escape/clear paths → `EMPTY_SELECTION`.

- [ ] **Step 6: Full verification, commit, push**

`npx tsc --noEmit && npx vitest run`, root `pnpm --filter desktop build:frontend`. Grep check: `grep -n "selectedCells" DataGrid.tsx` returns nothing.

```bash
git add apps/desktop/src/components/grid/gridSelection.ts apps/desktop/src/components/grid/__tests__/gridSelection.test.ts apps/desktop/src/components/grid/DataGrid.tsx
git commit -m "perf: rectangle selection model, O(1) drag extension"
git push origin master
```

---

### Task 5: Extract memoized `GridRow`/`GridCell`

The grid body is fully inline (DataGrid.tsx:1483-1670): 3 closures per row, 5 per cell, two `cn()` calls per cell (a 6-arg one at :1550-1557 and a 7-level nested ternary at :1639-1654), all re-created for ~7 000 visible cells on every DataGrid render. Extract `GridRow`/`GridCell` as `memo` components with primitive/stable props and shared handlers that read `data-*` attributes.

**Files:**
- Create: `apps/desktop/src/components/grid/GridRow.tsx` (both `GridRow` and `GridCell` live here — they change together)
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx` (:1483-1670 body, plus stable handler defs near the existing handlers)

**Interfaces:**
- Consumes: `buildPendingIndex`/`editKey` (Task 3), `CellSelection`/`isCellSelected` (Task 4), existing `columnarCellValue`, `getColWidthStyle` (:713-716 — returns `var(--col-N-w, Xpx)`, stays valid inside memo children), `fkMap`, virtualizer items.
- Produces: `GridRow` rendering one virtual row; DataGrid's body loop becomes `virtualItems.map((v) => <GridRow key={v.key} ... />)`.

- [ ] **Step 1: Design the prop contracts (write them first, they ARE the memo boundary)**

```tsx
// GridRow.tsx
interface GridRowProps {
  virtualIndex: number;        // visual index (virtualRow.index)
  actualRowIndex: number;      // paginatedIndexMap[virtualIndex]
  displayIndex: number;
  start: number;               // virtualRow.start for the translateY
  size: number;
  isOdd: boolean;
  isSelected: boolean;         // selectedRows.has(virtualIndex)
  rowDeleted: boolean;         // pendingIndex.deletedRows.has(actualRowIndex)
  alternatingRowColors: boolean;
  visibleColumns: ColumnMeta[];      // stable array from DataGrid memo
  visibleColIndexMap: number[];      // stable
  columnarData: ColumnData[];        // stable per result
  cellSelection: CellSelection;      // changes only when selection changes
  pendingIndex: PendingIndex;        // changes only when pendingChanges change
  editingCell: { rowIndex: number; colIndex: number } | null;
  focusedCell: { rowIndex: number; colIndex: number } | null;
  highlightedColIndex: number | null;
  fkMap: /* existing type */;
  handlers: GridBodyHandlers;        // ONE stable object, see step 2
}
```

`GridCell` receives the per-cell slice: `virtualIndex`, `actualRowIndex`, `colIdx`, `col`, `rawCell` (the `columnarCellValue` result — computed in GridRow), `isEditing`, `isCellSelected`, `isFocused`, `isHighlighted`, `pendingEdit` (`CellEdit | undefined`), `rowDeleted`, `fkTarget` (or null), `handlers`. All primitives or stable references, so `memo(GridCell)`'s shallow compare holds. Editing-branch inputs (editValue, onChange…) stay OUT of GridCell props: render the editing cell through the same GridCell but let GridCell pull the editing UI from a dedicated small `<CellEditor>` rendered when `isEditing` — only that one cell re-renders while typing (its `isEditing` prop flips its identity anyway).

Passing `cellSelection`/`pendingIndex`/`editingCell`/`focusedCell` to every GridRow means rows re-render when selection changes; per-cell booleans (`isCellSelected` etc.) are computed in GridRow so **GridCell** memo still prunes to the affected cells. That is the intended two-level boundary: DataGrid render → rows shallow-skip when untouched; row render → cells shallow-skip except the ones whose booleans flipped.

- [ ] **Step 2: One stable handler object reading `data-*`**

In DataGrid, build once:

```tsx
interface GridBodyHandlers {
  onCellMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
  onCellMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onCellContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onCellDoubleClick: (e: React.MouseEvent<HTMLElement>) => void;
  onCellValueClick: (e: React.MouseEvent<HTMLElement>) => void;
  onRowMouseEnter: (e: React.MouseEvent<HTMLElement>) => void;
  onRowContextMenu: (e: React.MouseEvent<HTMLElement>) => void;
  onRowGutterMouseDown: (e: React.MouseEvent<HTMLElement>) => void;
}
```

Each implementation reads indices from the element: cells render `data-vrow={virtualIndex} data-arow={actualRowIndex} data-col={colIdx}`, rows the same minus `data-col`. Handlers parse with `Number(e.currentTarget.dataset.vrow)` etc. and then call the existing logic (which mostly lives in useCallbacks already — `handleCellMouseDown` etc. from Task 4). Wrap the eight in a single `useMemo` producing one `handlers` object whose deps are the stable underlying callbacks. Any existing callback whose deps still churn (check each) must first be stabilized with the same getState()-at-call-time pattern used in Task 2 — otherwise the handlers object identity breaks every row's memo.

- [ ] **Step 3: Move the row/cell JSX**

Copy the row div (:1489-1533 shell) into `GridRow`, the cell div (:1534-1667) into `GridCell`, mechanically replacing captured locals with props. While moving, apply the two audit leftovers on lines you are already editing (in scope):
- Delete `transition-colors duration-300` from the cell wrapper class string (:1551).
- On the virtualized body container (the relative-positioned rows parent), add `contain: 'layout paint'` to its style object.
Both `cn()` calls move as-is otherwise — no class logic changes.

- [ ] **Step 4: Wire the loop**

DataGrid body becomes:

```tsx
{rowVirtualizer.getVirtualItems().map((virtualRow) => {
  const actualRowIndex = paginatedIndexMap[virtualRow.index];
  return (
    <GridRow
      key={virtualRow.key}
      virtualIndex={virtualRow.index}
      actualRowIndex={actualRowIndex}
      displayIndex={/* existing computation */}
      start={virtualRow.start}
      size={virtualRow.size}
      isOdd={virtualRow.index % 2 === 1}
      isSelected={selectedRows.has(virtualRow.index)}
      rowDeleted={pendingIndex.deletedRows.has(actualRowIndex)}
      alternatingRowColors={alternatingRowColors}
      visibleColumns={visibleColumns}
      visibleColIndexMap={visibleColIndexMap}
      columnarData={columnarData}
      cellSelection={cellSelection}
      pendingIndex={pendingIndex}
      editingCell={editingCell}
      focusedCell={focusedCell}
      highlightedColIndex={highlightedColIndex}
      fkMap={fkMap}
      handlers={handlers}
    />
  );
})}
```

`GridRow` and `GridCell` are both `memo(...)` with default shallow compare. Column width lookups keep going through `getColWidthStyle` (CSS vars — resize stays out of React).

- [ ] **Step 5: Full verification**

`npx tsc --noEmit && npx vitest run`, root `pnpm --filter desktop build:frontend`.
Manual parity checklist for the report (reviewer verifies against the diff, no DOM tests exist): plain click / drag / shift-click / ctrl-click selection; double-click edit + Escape/Enter; NULL button; context menu on cell and row gutter; copy selection; FK-value click; column highlight pulse; deleted-row strikethrough; pending-edit styling; alternating row colors toggle.

- [ ] **Step 6: Commit, push**

```bash
git add apps/desktop/src/components/grid/GridRow.tsx apps/desktop/src/components/grid/DataGrid.tsx
git commit -m "perf: extract memoized GridRow/GridCell with stable data-* handlers"
git push origin master
```

---

## Explicitly out of scope (do not do)

- Column virtualization, sidebar virtualization (wave 4).
- Export/copy in worker, structure cache, driver-level columnar, binary IPC (wave 5).
- `estimateTabMemory` sampling — scouting showed it is NOT on the appendChunk path (only finishStream/setResult), so the audit overstated it; parked.
- jsdom/RTL test infra — known gap (followups doc :26); this wave verifies components via typecheck+build+review and pure modules via vitest.
- SqlEditor/EditorToolbar/EditorTabs/FilterBar inline props (noted by scouting; candidates for a later polish pass, not grid-critical).

## Self-review notes

- Spec coverage: audit P2 items 1 (Task 1+2), 3 (Tasks 4+5), 5 (Task 3), plus the two item-6 leftovers folded into Task 5 on touched lines. Item 2 (column virtualization) and item 4 (worker export) are explicitly out of scope per the wave plan.
- Type consistency: `PendingIndex`/`buildPendingIndex`/`editKey` (Task 3) consumed by Task 5 with the same names; `CellSelection`/`isCellSelected`/`EMPTY_SELECTION` (Task 4) consumed by Task 5; `getActiveResult` signature unchanged (Task 1) consumed by Task 2.
- Line numbers are from scouting at commit e1c4f2f and may drift — every task says to grep before editing.
