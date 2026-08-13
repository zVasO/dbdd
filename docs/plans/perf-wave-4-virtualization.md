# Perf Wave 4 — Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make wide tables (200+ columns) and large schemas (500+ tables) fluid: virtualize DataGrid columns and the sidebar tree, and kill the remaining P3 re-render hot spots.

**Architecture:** Four tasks. Task 1 windows DataGrid's columns with a horizontal virtualizer used only to compute a `[colStart, colEnd)` slice — rendering stays flex-flow with two numeric spacer divs, which preserves the CSS-variable resize scheme untouched; the slice bounds flow into `GridRow` as two primitives so wave 3's memo boundary survives. Tasks 2–3 rebuild the sidebar as a pure flatten module (unit-tested in node env, wave-3 style) rendered by one row virtualizer with memoized rows, one shared context menu and one mounted tooltip, and per-slice `structures` subscriptions. Task 4 sweeps the audited P3 one-liners (ActivityBar, EditorTabs, dead QueryTimeline, ER debounce, COUNT(*) cache + db-key bug, faker metadata split).

**Tech Stack:** React 19, Zustand 5, @tanstack/react-virtual v3, vitest 2 (node env, pure functions only), TypeScript strict, radix-ui 1.4.

## Global Constraints

- All verification commands must pass at the end of every task: `npx tsc --noEmit`, `npx vitest run` (both from `apps/desktop`), `pnpm --filter desktop build:frontend` (from repo root). Rust untouched by this wave — do not run cargo.
- Work directly on `master`. After each task's final commit, `git push origin master`. If rejected: `git fetch origin && git rebase origin/master`, push again.
- Every commit message ends with the two trailers, exactly:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_01CVerLtPhHhQbDjA6p7ZMaG`
- Surgical diffs; no comments explaining what changed (comments only for constraints code can't show).
- Wave-3 invariants are load-bearing; breaking any is a Critical:
  - `GridRow`/`GridCell` props stay primitives or identity-stable references; keystrokes in the cell editor must never change a `GridRow` prop (editor rides `GridEditorContext`, DataGrid.tsx:1039-1052 / GridRow.tsx:83).
  - The 8 grid body handlers keep `[]` deps and read live state from `bodyStateRef` (DataGrid.tsx:774-785, published in `useLayoutEffect`) + `data-*` attributes. New handlers follow the same rule.
  - `data-col` carries the UNFILTERED column index (GridRow.tsx:51-56); `data-vrow` visual, `data-arow` actual. Never repurpose.
  - `pendingIndex.edits` is keyed by column NAME (`editKey(actualRowIndex, col.name)`), so cell rendering needs the sliced `ColumnMeta` objects, not bare indexes.
- No DOM test infra exists (node env only) — new logic that needs tests must be extracted as pure modules (the wave-3 pattern); component wiring is verified by typecheck + build + review.
- Line numbers cited below are from scouting at commit 527bb1c and may drift — grep for the anchors before editing.

---

### Task 1: DataGrid column virtualization

`useVirtualizer` covers rows only (DataGrid.tsx:579-584); with 200 columns × ~30 visible rows every scroll tick renders ~7 000 cells. Add a horizontal window over `visibleColumns` while preserving two wave-3/earlier design pillars: the CSS-variable resize scheme (widths live in `--col-N-w` vars on the scroll container during a drag, committed to `columnWidths` state only on mouseup — DataGrid.tsx:609-676) and the GridRow memo boundary.

**Design (locked by scouting):**
- A horizontal `useVirtualizer` (`horizontal: true`, same `getScrollElement: () => parentRef.current` — the container scrolls both axes, DataGrid.tsx:1441-1454) is used ONLY to compute the visible window and to own `scrollToIndex`. Rendering does NOT use its absolute offsets: the three column loops (header :1460, GridRow.tsx:267, inserted rows :1572-1598) keep flex flow and render `visibleColumns.slice(colStart, colEnd)` between two spacer `<div>`s with numeric pixel widths.
- Spacer widths are computed from `columnWidths` state + `DEFAULT_COL_WIDTH` — plain numbers. This is correct during a resize drag because only mounted columns can be dragged, and spacer columns are by definition unmounted, so their widths cannot change mid-drag.
- The window is the union of: the virtualizer's `[first, last]` visible range (overscan 3), the editing column's `visIdx` (an edit must never unmount mid-edit), and the focused column's `visIdx`. Union as a contiguous `[min, max]` range — slicing must stay contiguous for the spacer model.
- `GridRow` gains two PRIMITIVE props `colStart: number, colEnd: number` (slice bounds into `visibleColumns`) plus `leftSpacerWidth: number, rightSpacerWidth: number`. Passing virtual-item arrays would re-render every row on every horizontal scroll pixel — forbidden.
- `estimateSize: (visIdx) => columnWidths[visibleColIndexMap[visIdx]] ?? DEFAULT_COL_WIDTH`; after a resize commit (mouseup writes state :629) call `columnVirtualizer.measure()` in an effect keyed on `columnWidths`. During the drag the window math uses pre-drag widths — overscan 3 absorbs the drift.
- Keyboard nav / highlight scroll: there is NO horizontal scroll-into-view today (scout: mandatory once columns unmount). After moving focus horizontally (`handleGridKeyDown` Left/Right/Home/End/Tab, DataGrid.tsx:1152-1238) trigger `columnVirtualizer.scrollToIndex(visIdx)` — do it in an effect keyed on `focusedCell?.col`, translating unfiltered→visIdx via `visibleColIndexMap.indexOf`. Replace the manual `offsetX` accumulation + `scrollTo` in the highlight effect (:311-336) with `columnVirtualizer.scrollToIndex(highlightVisIdx, { align: 'start' })`.

**Files:**
- Modify: `apps/desktop/src/components/grid/DataGrid.tsx` (virtualizer block ~:579, header loop ~:1456-1510, inserted-rows loop ~:1572-1598, GridRow call site ~:1538-1567, highlight effect ~:311-336, keyboard nav ~:1152-1238)
- Modify: `apps/desktop/src/components/grid/GridRow.tsx` (props ~:199-221, cell loop ~:267-289)
- Test: `apps/desktop/src/components/grid/__tests__/gridColumnWindow.test.ts` (create)
- Create: `apps/desktop/src/components/grid/gridColumnWindow.ts` (pure window/spacer math)

**Interfaces:**
- Consumes: `visibleColumns`/`visibleColIndexMap` (DataGrid.tsx:300-308), `columnWidths: Record<number, number>` keyed by UNFILTERED index (:254), `getColWidthStyle` (:691-694), GridRow props contract (GridRow.tsx:199-221).
- Produces:
  ```ts
  // gridColumnWindow.ts
  export interface ColumnWindow { colStart: number; colEnd: number; leftSpacerWidth: number; rightSpacerWidth: number; }
  export function computeColumnWindow(args: {
    rangeStart: number; rangeEnd: number;        // virtualizer visible range (inclusive/exclusive), already overscanned
    pinnedVisIdxs: ReadonlyArray<number | null>; // editing column visIdx, focused column visIdx (null = none)
    widths: ReadonlyArray<number>;               // per-visIdx pixel widths (columnWidths[colIdx] ?? DEFAULT)
  }): ColumnWindow;
  ```
  `GridRow` props extended with `colStart`, `colEnd`, `leftSpacerWidth`, `rightSpacerWidth` (all numbers).

- [ ] **Step 1: Write the failing tests for the pure window math**

```ts
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
```

- [ ] **Step 2: Run, verify module-not-found failure** — `npx vitest run src/components/grid/__tests__/gridColumnWindow.test.ts`.

- [ ] **Step 3: Implement `gridColumnWindow.ts`** (clamp range, take min over pinned for start / max+1 for end, prefix-sum the outside widths). Run tests → green.

- [ ] **Step 4: Wire the horizontal virtualizer in DataGrid**

Alongside `rowVirtualizer` (~:579):
```tsx
const columnVirtualizer = useVirtualizer({
  horizontal: true,
  count: visibleColumns.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (visIdx) => columnWidths[visibleColIndexMap[visIdx]] ?? DEFAULT_COL_WIDTH,
  overscan: 3,
});
```
Derive the window once per render (NOT per row): virtual items → `rangeStart/rangeEnd`, pinned = editing column visIdx (`editingPosition` → `visibleColIndexMap.indexOf(editingPosition.colIndex)`) and focused column visIdx; per-visIdx widths array via `useMemo` on `[visibleColumns, visibleColIndexMap, columnWidths]`; then `computeColumnWindow`. Re-measure effect: `useEffect(() => { columnVirtualizer.measure(); }, [columnWidths, visibleColumns.length])`.

- [ ] **Step 5: Slice the three column loops**

Header (~:1460) and inserted-rows (~:1581): wrap each loop as `leftSpacer div (style={{width: leftSpacerWidth, flexShrink: 0}})` + `visibleColumns.slice(colStart, colEnd).map((col, i) => { const visIdx = colStart + i; const colIdx = visibleColIndexMap[visIdx]; ...existing body unchanged... })` + right spacer. `aria-colindex` stays `visIdx + 1`. GridRow: add the four new primitive props, slice inside GridRow the same way (its cell loop ~:267), keep passing the full `visibleColumns`/`visibleColIndexMap` arrays (identity-stable, memo-safe).

- [ ] **Step 6: Scroll-into-view + highlight**

Effect on `focusedCell?.col` (translate to visIdx; `columnVirtualizer.scrollToIndex(visIdx)`); replace the highlight effect's manual `offsetX` loop + `parentRef.scrollTo` (~:311-336) with `scrollToIndex(highlightVisIdx, { align: 'start' })`. Delete the now-unused width-accumulation code.

- [ ] **Step 7: Full verification, self-check, commit, push**

`npx tsc --noEmit && npx vitest run`; root `pnpm --filter desktop build:frontend`. Self-check before committing: grep GridRow.tsx for any new non-primitive prop; confirm no handler gained a dep; confirm `data-col` still carries unfiltered indexes in all three loops.

```bash
git add apps/desktop/src/components/grid/gridColumnWindow.ts apps/desktop/src/components/grid/__tests__/gridColumnWindow.test.ts apps/desktop/src/components/grid/DataGrid.tsx apps/desktop/src/components/grid/GridRow.tsx
git commit -m "perf: virtualize DataGrid columns behind a windowed slice"
git push origin master
```

---

### Task 2: Sidebar — pure flatten module + virtualized, memoized rows

500 tables currently mount ~4 000 Radix component instances (8 per TableNode — Collapsible/ContextMenu/Tooltip stack, TableNode.tsx:83-138 — plus 3 per ColumnNode, 3 per DatabaseNode), none memoized, every prop an inline closure (Sidebar.tsx:476-487, DatabaseNode.tsx:97-107, TableNode.tsx:217-218). Rebuild the tree as data: one pure `flattenSidebarTree` module (unit-tested), one `useVirtualizer` list, one memoized `SidebarRow` with the wave-3 data-* handler pattern. This task does structure + virtualization + memo; Task 3 does shared menu/tooltip + store subscriptions.

**Files:**
- Create: `apps/desktop/src/components/layout/sidebar/sidebarTree.ts` (pure flatten)
- Create: `apps/desktop/src/components/layout/sidebar/SidebarRow.tsx` (memoized row renderer)
- Modify: `apps/desktop/src/components/layout/Sidebar.tsx` (render paths A ~:466-490 and B ~:442,:497; ScrollArea ~:379; expansion state stays)
- Modify/absorb: `apps/desktop/src/components/layout/sidebar/{SchemaTree,DatabaseNode,TableNode,ColumnNode}.tsx` (their JSX moves into SidebarRow; delete what empties — keep `FuzzySearchResults` and `utils.tsx`)
- Test: `apps/desktop/src/components/layout/sidebar/__tests__/sidebarTree.test.ts` (create)

**Interfaces:**
- Consumes: `expandedDbs: Set<string>`, `expandedTables: Set<string>` (Sidebar.tsx:77-78), `structures: Record<string, TableStructure>` keyed `` `${db}.${table}` `` (schemaStore.ts:10,30-32), `databases`/`tables` from schemaStore, `structureLoading`.
- Produces (Task 3 consumes `FlatNode` and the row's data-* contract):
  ```ts
  export type FlatNode =
    | { kind: 'db'; key: string; db: string; expanded: boolean; tableCount: number }
    | { kind: 'table'; key: string; db: string; table: string; expanded: boolean; loading: boolean }
    | { kind: 'column'; key: string; db: string; table: string; name: string; dataType: string; nullable: boolean; isPk: boolean; isFk: boolean };
  export function flattenSidebarTree(args: {
    mode: 'flat' | 'nested';                    // flat = single active database (no db rows)
    databases: string[];
    tablesByDb: Record<string, TableInfo[]>;
    expandedDbs: ReadonlySet<string>;
    expandedTables: ReadonlySet<string>;        // keys `${db}.${table}`
    structures: Record<string, TableStructure | undefined>;
    structureLoading: Record<string, boolean | undefined>;
    autoExpandTables?: ReadonlySet<string>;     // search-driven expansion (DatabaseNode.tsx:94 behavior)
  }): FlatNode[];
  ```
  SidebarRow data-* contract: every row div carries `data-kind` and `data-key` (+ `data-db`, `data-table`, `data-colname` where applicable); ONE stable handlers object `{ onRowClick, onRowDoubleClick, onRowContextMenu, onCaretClick }` reads them.

- [ ] **Step 1: Write the failing flatten tests**

```ts
import { describe, it, expect } from 'vitest';
import { flattenSidebarTree } from '../sidebarTree';

const t = (name: string) => ({ name }) as never; // adapt to real TableInfo shape
const structure = (cols: string[]) =>
  ({ columns: cols.map((c) => ({ name: c, data_type: 'text', nullable: true })) }) as never;

describe('flattenSidebarTree', () => {
  it('nested mode lists dbs, expands only expanded dbs', () => {
    const nodes = flattenSidebarTree({
      mode: 'nested', databases: ['a', 'b'],
      tablesByDb: { a: [t('t1'), t('t2')], b: [t('t3')] },
      expandedDbs: new Set(['a']), expandedTables: new Set(),
      structures: {}, structureLoading: {},
    });
    expect(nodes.map((n) => n.key)).toEqual(['a', 'a.t1', 'a.t2', 'b']);
    expect(nodes[0]).toMatchObject({ kind: 'db', expanded: true, tableCount: 2 });
  });

  it('expanded table with a loaded structure emits its column rows', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat', databases: ['a'], tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(), expandedTables: new Set(['a.t1']),
      structures: { 'a.t1': structure(['id', 'name']) }, structureLoading: {},
    });
    expect(nodes.map((n) => n.kind)).toEqual(['table', 'column', 'column']);
    expect(nodes[1]).toMatchObject({ kind: 'column', name: 'id', table: 't1' });
  });

  it('expanded table still loading emits the table row flagged loading, no columns', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat', databases: ['a'], tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(), expandedTables: new Set(['a.t1']),
      structures: {}, structureLoading: { 'a.t1': true },
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ kind: 'table', expanded: true, loading: true });
  });

  it('autoExpandTables expands without touching expandedTables (search behavior)', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat', databases: ['a'], tablesByDb: { a: [t('t1')] },
      expandedDbs: new Set(), expandedTables: new Set(),
      structures: { 'a.t1': structure(['id']) }, structureLoading: {},
      autoExpandTables: new Set(['a.t1']),
    });
    expect(nodes.map((n) => n.kind)).toEqual(['table', 'column']);
  });

  it('flat mode emits no db rows and only the given database', () => {
    const nodes = flattenSidebarTree({
      mode: 'flat', databases: ['a'], tablesByDb: { a: [t('t1'), t('t2')] },
      expandedDbs: new Set(), expandedTables: new Set(),
      structures: {}, structureLoading: {},
    });
    expect(nodes.every((n) => n.kind === 'table')).toBe(true);
  });
});
```

Adapt literals to the real `TableInfo`/`TableStructure` types; read TableNode/ColumnNode first to carry over exactly which per-column facts the rows render (pk/fk markers, type text) into `FlatNode['column']`.

- [ ] **Step 2: Run → module not found. Implement `sidebarTree.ts`. Run → green.**

- [ ] **Step 3: Build `SidebarRow.tsx`**

One `memo` component switching on `node.kind`, rendering the same visual row content as today's DatabaseNode/TableNode/ColumnNode JSX (icons, names, counts, pk/fk badges, loading spinner) but with: no Collapsible (expansion is data — the flatten already decided what's visible; the caret is a plain rotated chevron), no per-row ContextMenu/Tooltip (Task 3 replaces them — in THIS task attach `data-*` and `onContextMenu` via the handlers object, and drop tooltips temporarily is NOT acceptable: keep a `title` attribute fallback this task so no information disappears, Task 3 restores rich tooltips). Props: `node: FlatNode`, `isActive: boolean`, `isFavorite: boolean`, `handlers: SidebarRowHandlers` — nothing else; all primitives except the two stable objects.

- [ ] **Step 4: Rewire Sidebar**

- Replace the `ScrollArea` subtree (~:379) for the tree area with a plain `<div ref={treeScrollRef} className="flex-1 overflow-y-auto">` (scout: the Radix wrapper can't expose its viewport ref; the ScrollArea stays wherever it wraps non-tree content).
- `useVirtualizer({ count: flatNodes.length, getScrollElement: () => treeScrollRef.current, estimateSize: () => 28, overscan: 8 })` — measure the real row height from the current CSS before hardcoding 28.
- `flatNodes = useMemo(() => flattenSidebarTree({...}), [deps])` — feed it paths A and B (Sidebar.tsx:431-517): flat mode when `activeDatabase && !searchQuery`, nested otherwise; path C (`FuzzySearchResults`) stays as is.
- Handlers: one `useMemo`'d object; callbacks with `[]` deps reading `data-*` + a `sidebarStateRef` snapshot (mirror DataGrid.tsx:774-785 with `useLayoutEffect`) for `toggleDb`/`toggleTable`/table-click/column-double-click. The existing togglers (Sidebar.tsx:137-170) keep their lazy-load logic — move their bodies behind the snapshot pattern.
- Delete `SchemaTree.tsx`'s nested render path and `DatabaseNode.tsx` if nothing else imports them (SchemaTree's flat search-results mode :100-165 — fold its trigger condition into path C or keep the component only for that mode; state which you did in the report). `TableNode`/`ColumnNode` deleted once SidebarRow covers their rendering (grep importers first: `sidebar/index.ts`).

- [ ] **Step 5: Full verification, commit, push**

Self-check: `grep -n "Collapsible\|ContextMenu\|Tooltip" Sidebar.tsx SidebarRow.tsx` — per-row instances must be gone (Task 3 adds the shared ones); confirm favorites toggle, drop/truncate/rename menu ACTIONS are still reachable (temporarily via the row context-menu handler storing the node — if the menu UI itself must wait for Task 3, keep the OLD context menu wiring alive at the Sidebar level operating on the clicked row's data; the report must state exactly what works after this task).

```bash
git add apps/desktop/src/components/layout/sidebar/ apps/desktop/src/components/layout/Sidebar.tsx
git commit -m "perf: flatten and virtualize the sidebar tree with memoized rows"
git push origin master
```

---

### Task 3: Sidebar — shared context menu/tooltip, sliced subscriptions, backdrop

Finish the sidebar: exactly one ContextMenu and at most one mounted Tooltip for the whole tree, `structures`/`structureLoading` subscriptions narrowed so a structure load re-renders only the rows it feeds, and the `backdrop-blur-xl` swap.

**Files:**
- Modify: `apps/desktop/src/components/layout/Sidebar.tsx`, `apps/desktop/src/components/layout/sidebar/SidebarRow.tsx`
- Test: extend `apps/desktop/src/components/layout/sidebar/__tests__/sidebarTree.test.ts` only if you add pure logic; otherwise no new tests (wiring task).

**Interfaces:**
- Consumes: Task 2's `FlatNode`, `SidebarRow`, handlers object, flatten deps.
- Produces: no new exports; behavior contract — right-click any row opens the same menu items as the old per-node menus (8 items + 2 separators for tables, TableNode.tsx:162-198; db/column menus per their old content); hovering a row shows the same tooltip content as the old per-node tooltips after the same delay.

- [ ] **Step 1: Shared context menu**

One `ContextMenu` at the Sidebar level. Right-click handler (already in the handlers object) records `menuTarget: FlatNode | null` in state and opens the menu at the pointer (Radix ContextMenu opens from the trigger's event — wrap the tree container as the single `ContextMenuTrigger asChild`; the handler stores which row was hit before the menu opens). Menu content renders from `menuTarget.kind` — port the old items verbatim (open/browse, favorite toggle, truncate, drop, rename, copy name, etc.; grep the old TableNode/DatabaseNode/ColumnNode menu JSX from git history at 527bb1c if already deleted). Destructive items keep going through `ConfirmDestructiveDialog`.

- [ ] **Step 2: Shared tooltip**

Track `hoveredKey: string | null` via `onMouseEnter` on rows (add to handlers; `data-key` read). Render ONE `Tooltip` whose trigger is anchored to the hovered row element (Radix needs a real anchor: keep it simple — only the hovered row wraps itself in `Tooltip`/`TooltipTrigger` when `node.key === hoveredKey`; every other row renders the plain div; the `title` fallback from Task 2 is removed). This keeps at most one Radix tooltip mounted. `hoveredKey` changing re-renders only the two affected rows IF it doesn't flow through props that break memo — pass `isHovered: boolean` to each row (primitive; only two rows flip per hover change). If measuring shows hover-churn re-rendering the whole list (state lives in Sidebar → re-renders the map), gate it: hoveredKey state may live in a tiny wrapper component around the virtualized list so Sidebar itself doesn't re-render per hover; state your choice in the report.

- [ ] **Step 3: Slice the store subscriptions**

- Sidebar today: `const structures = useSchemaStore((s) => s.structures)` (:50) + `structureLoading` (:51). The flatten needs only the EXPANDED tables' structures. Subscribe narrowly:
```tsx
const expandedKeys = useMemo(() => [...expandedTables], [expandedTables]);
const expandedStructures = useSchemaStore(
  useShallow((s) => expandedKeys.map((k) => s.structures[k]))
);
const expandedLoading = useSchemaStore(
  useShallow((s) => expandedKeys.map((k) => !!s.structureLoading[k]))
);
```
Rebuild the `structures`/`structureLoading` records passed to `flattenSidebarTree` from these arrays (useMemo). A structure load for a COLLAPSED table no longer re-renders the sidebar; a load for an expanded one changes one array slot → useShallow catches it.
- Fix the other broad subscribers that are trivial one-line narrowings, listed by scouting: `TableStructureView.tsx:127` (subscribe to `s.structures[key]` directly), `BuilderToolbar.tsx:28` (move the read into the callback via `useSchemaStore.getState()`), `DataGeneratorDialog.tsx:56` (destructure via selectors). Do NOT touch ERDiagramView here (Task 4 owns it).

- [ ] **Step 4: Backdrop swap**

Sidebar.tsx:265: `backdrop-blur-xl` → `backdrop-blur-sm` (keep `bg-sidebar/80`; if the visual result looks wrong in the build, `bg-sidebar` opaque + no blur is the sanctioned fallback — say which you shipped).

- [ ] **Step 5: Full verification, commit, push**

Self-check: grep `useSchemaStore((s) => s.structures)` — zero broad subscribers left outside ERDiagramView; count ContextMenu/Tooltip instances in the sidebar tree (1 / ≤1).

```bash
git add apps/desktop/src/components/layout/ apps/desktop/src/components/grid/TableStructureView.tsx apps/desktop/src/components/query-builder/BuilderToolbar.tsx apps/desktop/src/components/data-gen/DataGeneratorDialog.tsx
git commit -m "perf: shared sidebar menu/tooltip and sliced structure subscriptions"
git push origin master
```

(Adjust paths to the real locations of BuilderToolbar/DataGeneratorDialog — grep first.)

---

### Task 4: Annex one-liners (P3 sweep)

Six independent, small fixes verified by scouting. One commit each is overkill — group as two commits (dead-code delete separate, the rest together) or one; keep the diff per file surgical.

**Files:**
- Modify: `apps/desktop/src/components/layout/ActivityBar.tsx`
- Modify: `apps/desktop/src/components/editor/EditorTabs.tsx`
- Delete: `apps/desktop/src/components/editor/QueryTimeline.tsx`
- Modify: `apps/desktop/src/components/er-diagram/ERDiagramView.tsx`
- Modify: `apps/desktop/src/components/layout/PanelLayout.tsx`
- Modify: `apps/desktop/src/components/data-gen/ProviderSelect.tsx` + `apps/desktop/src/lib/dataGenProviders.ts` (split)
- Test: `apps/desktop/src/lib/__tests__/dataGenProviderMeta.test.ts` (create, only if the split extracts pure metadata — see below)

**Interfaces:** none consumed by later tasks.

- [ ] **Step 1: ActivityBar (ActivityBar.tsx:31-49)**

Replace the selector-less `useActivityStore()` destructure (:32) with individual selectors; collapse the three unmemoized passes (`runningCount` :43, `errorCount` :44, `filteredEntries` :46-49) into ONE `useMemo` over `[entries, filter]` returning `{ runningCount, errorCount, filteredEntries }`. Wrap the component in `memo`.

- [ ] **Step 2: EditorTabs (EditorTabs.tsx:38)**

`const tabResults = useResultStore((s) => s.results)` feeds only `tabResults[tab.id]?.isStale` (:109). Replace with a per-render map of booleans:
```tsx
const staleByTab = useResultStore(
  useShallow((s) => tabs.map((t) => !!s.results[t.id]?.isStale))
);
```
and index by position — or move the boolean read into a tiny memoized `<TabStaleDot tabId>` that subscribes to `s.results[tabId]?.isStale` itself. Either is fine; streaming flushes must stop re-rendering the tab bar (the `isStale` boolean is stable across appendChunk writes — verify by reading appendChunk before choosing).

- [ ] **Step 3: Delete QueryTimeline.tsx**

Scout confirmed zero importers (grep again first). Plain `git rm`.

- [ ] **Step 4: ER diagram debounce (ERDiagramView.tsx:125-129)**

The effect `useEffect(() => { if (!selectedDatabase) return; generateDiagram(selectedDatabase); }, [structures])` fires per structure load. Debounce ~300ms:
```tsx
useEffect(() => {
  if (!selectedDatabase) return;
  const t = setTimeout(() => generateDiagram(selectedDatabase), 300);
  return () => clearTimeout(t);
}, [structures, selectedDatabase]);
```
(dagre already runs once per db — :133-147 — leave that alone.)

- [ ] **Step 5: COUNT(*) cache + db-key bug (PanelLayout.tsx:161-183)**

The guard `prevTableRef.current === activeTab.table` (:171) ignores the database (cross-db same-name tables collide — real bug) and re-fires on every A→B→A alternation. Replace the ref with a module-level `Map<string, number>` keyed `` `${connectionId}:${database}.${table}` ``: on hit, use the cached total (no query); on miss, run the COUNT and store it. Invalidate: clear the map entries for a connection on disconnect if a hook exists cheaply, and always bypass+refresh the cache after a successful non-SELECT execution on that table is NOT tractable here — accept staleness with a simple TTL (e.g. entry stores `{count, at}`, refetch if older than 60s). Keep the existing effect deps.

- [ ] **Step 6: Faker metadata split (ProviderSelect.tsx:3, dataGenProviders.ts:1)**

Create `apps/desktop/src/lib/dataGenProviderMeta.ts` exporting only `{ id, label, category }[]` (derive by copying the metadata fields of the ~100 providers — no faker import). `ProviderSelect` imports the metadata module; `dataGenProviders.ts` (with faker) keeps the `generate` closures and stays behind `dataGenStore`'s existing lazy `loadProviders()` (:7-11). Add a tiny test asserting metadata ids match `providers` ids? That would import faker in the test — skip the cross-check test; instead assert the metadata module itself is faker-free by checking `dataGenProviderMeta.ts` has no faker import (review-level, not a test). Verify in the build output (`pnpm --filter desktop build:frontend`) that the ProviderSelect-containing chunk no longer pulls faker (name the chunk in your report; the faker chunk should only be reachable from the dataGenStore dynamic import).

- [ ] **Step 7: Full verification, commit(s), push**

```bash
git rm apps/desktop/src/components/editor/QueryTimeline.tsx
git commit -m "chore: delete dead QueryTimeline component"
git add -A apps/desktop/src
git commit -m "perf: annex re-render sweep (ActivityBar, EditorTabs, ER debounce, COUNT cache, faker split)"
git push origin master
```

---

## Explicitly out of scope (do not do)

- Export/copy in worker, Rust structure cache, driver columnar, CSV import, binary IPC — wave 5 (planned separately).
- jsdom/RTL infra (unchanged gap); FuzzySearchResults virtualization (bounded result set); `estimateTabMemory` sampling (parked in wave 3 doc).
- Wave-3 deferred minors (gridCellValue.ts extraction etc.) — polish pass, not this wave.

## Self-review notes

- Spec coverage: audit P2.2 → Task 1; P3 sidebar items 1-3 → Tasks 2-3; P3 one-liners (backdrop → T3; ActivityBar, EditorTabs, QueryTimeline, ER debounce, COUNT(*), faker split → T4). P3 "EditorTabs" and "ActivityBar-like patterns in LiveMetrics/AlertConfig/AlertHistory/TableDesigner/ImportDialog" — the lazy-mounted ones stay out (audit itself deprioritized them).
- Scout deviations honored: `_columnsByDb` is NOT mirrored (per-slice useShallow subscriptions instead); spacer/slice design avoids the resize-scheme conflict; QueryTimeline is dead code (not a live timer); faker is a dialog-open cost (split still worthwhile, smaller claim); ER dagre already once-per-db (debounce only generateDiagram).
- Type consistency: `FlatNode`/`flattenSidebarTree` (T2) consumed by T3; `computeColumnWindow`/`ColumnWindow` (T1) self-contained; GridRow prop names (`colStart`/`colEnd`/`leftSpacerWidth`/`rightSpacerWidth`) used consistently in T1 only.
- Line numbers from 527bb1c; every task instructs grep-before-edit.
