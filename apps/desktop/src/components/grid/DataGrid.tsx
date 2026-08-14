import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, useDeferredValue, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Key, Plus, Search, Trash2, X, Filter, Eye, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight as ChevronRightIcon, ChevronsLeft, ChevronsRight, Copy, CopyPlus, ClipboardPaste, FileJson, Table2, FileCode, FileText } from 'lucide-react';
import { copyCellAsJson, copyCellAsText, copyToClipboard } from '@/lib/copyFormats';
import { copyFormatted, runExport } from '@/lib/exportRunner';
import type { ColumnarSlice, CopyFormat } from '@/lib/columnarFormat';
import type { QueryResult, CellValue, ColumnData } from '@/lib/types';
import { ipc } from '@/lib/ipc';
import { useChangeStore, type Change } from '@/stores/changeStore';
import { useShallow } from 'zustand/shallow';
import { useFilterStore } from '@/stores/filterStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useQueryStore } from '@/stores/queryStore';
import { useResultStore, formatColumnarCell } from '@/stores/resultStore';
import { useConnectionStore } from '@/stores/connectionStore';
import { buildPendingIndex } from './gridPendingChanges';
import {
  EMPTY_SELECTION, selectSingle, extendTo, toggleCell,
  isCellSelected as isCellInSelection, selectionSize, materializeCells, isEmpty as isSelectionEmpty,
  type CellSelection,
} from './gridSelection';
import {
  GridRow, GridEditorContext, columnarCellValue, formatCell,
  type GridBodyHandlers, type GridEditorContextValue,
} from './GridRow';
import { Button } from '@/components/ui/button';
import { QuickLook } from './QuickLook';
import { resolveColumnarSource } from './gridDataSource';
import { computeColumnWindow } from './gridColumnWindow';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useShortcutStore, matchesBinding } from '@/stores/shortcutStore';
import { quoteIdentifier, escapeStringLiteral } from '@/lib/sql-utils';
import type { SortColumn, GridWorkerResponse } from '@/workers/gridWorker.protocol';

interface SortRequest {
  column: string;
  direction: 'asc' | 'desc';
}

interface Props {
  result: QueryResult;
  database?: string;
  table?: string;
  /** Explicit columnar data source, bypassing the active-tab result store (e.g. synthetic views like TableStructureView) */
  data?: ColumnData[];
  /** Row count for `data`; defaults to result.rows.length when omitted */
  rowCount?: number;
  onServerSort?: (sorts: SortRequest[]) => void;
  /** Server-side pagination: called when user navigates to a different page (browse mode only) */
  onServerPageChange?: (page: number, pageSize: number) => void;
  /** Server-side pagination: total row count of the table (from COUNT(*)) */
  serverTotalRows?: number;
  /** Server-side pagination: current server page (0-based) */
  serverPage?: number;
  /** Column name to scroll to and briefly highlight (from sidebar double-click) */
  highlightedColumnName?: string;
  /** Called after the highlight animation completes so the parent can clear the value */
  onHighlightDone?: () => void;
}

interface EditingCell {
  rowIndex: number;
  colIndex: number;
  value: string;
  isNull?: boolean;
  /** When true, cursor goes to end instead of selecting all (triggered by typing a char) */
  cursorAtEnd?: boolean;
}

const PAGE_SIZES = [50, 100, 300, 500, 1000] as const;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 80;
/** Width of the row-number gutter that precedes every column (matches w-[50px]) */
const ROW_NUM_WIDTH = 50;
/** How far outside the rendered range a focused column still holds itself mounted */
const FOCUS_PIN_SLACK = 5;

const TYPE_LABELS: Record<string, string> = {
  SmallInt: 'int', Integer: 'int', BigInt: 'bigint', Float: 'float', Double: 'double',
  Serial: 'serial', BigSerial: 'bigserial', Boolean: 'bool',
  Text: 'text', Blob: 'blob', Bytea: 'bytes',
  Date: 'date', Time: 'time', TimeTz: 'timetz', Timestamp: 'timestamp', TimestampTz: 'timestamptz',
  Interval: 'interval', Json: 'json', Jsonb: 'jsonb', Uuid: 'uuid',
  Inet: 'inet', Cidr: 'cidr', MacAddr: 'mac', Point: 'point', Line: 'line', Box: 'box', Circle: 'circle',
};

function formatDataType(dt: unknown): string {
  if (typeof dt === 'string') return TYPE_LABELS[dt] ?? dt.toLowerCase();
  if (dt && typeof dt === 'object') {
    const key = Object.keys(dt)[0];
    const val = (dt as Record<string, unknown>)[key];
    if (key === 'Varchar' || key === 'Char') return `${key.toLowerCase()}(${val ?? ''})`;
    if (key === 'Decimal') {
      const d = val as { precision?: number; scale?: number } | null;
      return d?.precision != null ? `decimal(${d.precision},${d.scale ?? 0})` : 'decimal';
    }
    if (key === 'Array') return `${formatDataType(val)}[]`;
    if (key === 'Enum') return 'enum';
    if (key === 'Unknown') return String(val).toLowerCase();
    return key.toLowerCase();
  }
  return 'unknown';
}

function getStoredPageSize(): number {
  const pref = usePreferencesStore.getState().defaultPageSize;
  return pref === 0 ? Infinity : pref;
}

// ─── Worker hook: offload filter/sort for large datasets ────────────────────

interface WorkerState {
  filteredIndices: number[] | null;
  sortedIndices: number[] | null;
}

function useGridWorker(
  data: ColumnData[] | undefined,
  filterText: string,
  sortColumns: SortColumn[],
  rowCount: number,
  resultKey: string,
): WorkerState & { useWorker: boolean } {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<WorkerState>({ filteredIndices: null, sortedIndices: null });
  const useWorker = rowCount > 1000 && !!data && data.length > 0;

  // Tracks what the worker already holds, so we send a full dataset only on a
  // new result and just the appended rows as it streams in.
  const sentKeyRef = useRef<string | null>(null);
  const sentRowCountRef = useRef(0);
  const [syncVersion, setSyncVersion] = useState(0);

  useEffect(() => {
    const worker = new Worker(
      new URL('../../workers/grid.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent<GridWorkerResponse>) => {
      if (e.data.type === 'filter-result') {
        setState((prev) => ({ ...prev, filteredIndices: e.data.indices }));
      }
      if (e.data.type === 'sort-result') {
        setState((prev) => ({ ...prev, sortedIndices: e.data.indices }));
      }
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
      sentKeyRef.current = null;
      sentRowCountRef.current = 0;
    };
  }, []);

  useEffect(() => {
    if (!useWorker) {
      setState({ filteredIndices: null, sortedIndices: null });
    }
  }, [useWorker]);

  // Sync data to the worker: full on a new result, delta as rows stream in.
  // Defined before the filter/sort effects so its messages are enqueued first.
  useEffect(() => {
    const worker = workerRef.current;
    if (!useWorker || !data || !worker) return;

    if (sentKeyRef.current !== resultKey) {
      worker.postMessage({ type: 'setData', columns: data });
      sentKeyRef.current = resultKey;
      sentRowCountRef.current = rowCount;
      setSyncVersion((v) => v + 1);
    } else if (rowCount > sentRowCountRef.current) {
      const from = sentRowCountRef.current;
      const delta = data.map((col) => ({
        kind: col.kind,
        values: (col.values as unknown[]).slice(from),
      }) as ColumnData);
      worker.postMessage({ type: 'appendData', columns: delta });
      sentRowCountRef.current = rowCount;
      setSyncVersion((v) => v + 1);
    }
  }, [useWorker, data, rowCount, resultKey]);

  // Filter/sort carry only parameters; they recompute when data resyncs.
  useEffect(() => {
    if (!useWorker || !workerRef.current) return;
    workerRef.current.postMessage({ type: 'filter', filterText });
  }, [useWorker, filterText, syncVersion]);

  useEffect(() => {
    if (!useWorker || !workerRef.current || sortColumns.length === 0) {
      setState((prev) => ({ ...prev, sortedIndices: null }));
      return;
    }
    workerRef.current.postMessage({
      type: 'sort',
      sortColumns,
      useFilteredInput: state.filteredIndices !== null,
    });
  }, [useWorker, sortColumns, state.filteredIndices, syncVersion]);

  return { ...state, useWorker };
}

export type { SortRequest };

export const DataGrid = memo(function DataGrid({ result, database, table, data: explicitData, rowCount: explicitRowCount, onServerSort, onServerPageChange, serverTotalRows, serverPage, highlightedColumnName, onHighlightDone }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [lastSelectedRow, setLastSelectedRow] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Quick Look state
  const [quickLookCell, setQuickLookCell] = useState<{
    cell: CellValue;
    columnName: string;
    columnType: string;
  } | null>(null);
  const [focusedColIndex, setFocusedColIndex] = useState<number>(0);

  // Keyboard focus cell (for grid keyboard navigation)
  const [focusedCell, setFocusedCell] = useState<{ row: number; col: number } | null>(null);

  // Column highlight state — driven by highlightedColumnName prop (from sidebar double-click)
  const [highlightedColIndex, setHighlightedColIndex] = useState<number | null>(null);
  const processedHighlightRef = useRef<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Cell selection state (rectangle anchor+focus plus ctrl-toggle add/remove — see gridSelection.ts)
  const [cellSelection, setCellSelection] = useState<CellSelection>(EMPTY_SELECTION);

  // Filter state
  const [filterInput, setFilterInput] = useState('');
  const filterText = useDeferredValue(filterInput);

  // Sorting state
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(getStoredPageSize);
  const [currentPage, setCurrentPage] = useState(0);

  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const resizingRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);
  const resizeRafRef = useRef<number>(0);
  // Snapshot ref for resize handler — avoids stale closure in the [] effect
  const resizeSnapshotRef = useRef<{
    visibleColumns: typeof visibleColumns;
    visibleColIndexMap: number[];
    columnWidths: Record<number, number>;
  }>({ visibleColumns: [], visibleColIndexMap: [], columnWidths: {} });

  // Drag selection state (rows)
  const isDraggingRef = useRef(false);
  const [dragStartRow, setDragStartRow] = useState<number | null>(null);

  // Drag selection state (cells) — anchor lives in cellSelection.anchor
  const isCellDraggingRef = useRef(false);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number; colIndex: number } | null>(null);

  // Preferences
  const alternatingRowColors = usePreferencesStore((s) => s.alternatingRowColors);
  const defaultCopyFormat = usePreferencesStore((s) => s.defaultCopyFormat);

  // Primary key columns from schema store — query results always have is_primary_key: false
  // so we cross-reference the schema structure which is populated separately.
  const schemaPrimaryKeys = useSchemaStore(
    useShallow((s) => {
      if (!database || !table) return null;
      const structure = s.structures[`${database}.${table}`];
      if (!structure) return null;
      return new Set(structure.columns.filter((c) => c.is_primary_key).map((c) => c.name));
    }),
  );

  // Change tracking — subscribe only to changes for this specific table
  const addChange = useChangeStore((s) => s.addChange);
  const pendingChanges: Change[] = useChangeStore(
    useShallow((s: { pending: Change[] }) =>
      database && table
        ? s.pending.filter((c: Change) => c.database === database && c.table === table)
        : [],
    ),
  );

  // Column visibility
  const columnVisibility = useFilterStore((s) => s.columnVisibility);
  const visibleColumns = useMemo(
    () => result.columns.filter((col) => columnVisibility[col.name] !== false),
    [result.columns, columnVisibility],
  );
  const visibleColIndexMap = useMemo(
    () => visibleColumns.map((col) => result.columns.indexOf(col)),
    [visibleColumns, result.columns],
  );

  // Per-visIdx pixel widths — the basis for both the horizontal virtualizer's
  // size estimates and the spacer sums.
  const columnWidthsByVisIdx = useMemo(
    () => visibleColIndexMap.map((colIdx) => columnWidths[colIdx] ?? DEFAULT_COL_WIDTH),
    [visibleColIndexMap, columnWidths],
  );

  // Horizontal virtualizer: computes the visible column window and owns
  // horizontal scroll-into-view. Rendering does not use its offsets — the
  // columns stay in flex flow behind numeric spacers — so the CSS-variable
  // resize scheme is untouched. `paddingStart` models the row-number gutter,
  // which precedes column 0 in the same scroll container.
  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: visibleColumns.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (visIdx) => columnWidths[visibleColIndexMap[visIdx]] ?? DEFAULT_COL_WIDTH,
    overscan: 3,
    paddingStart: ROW_NUM_WIDTH,
  });

  // Widths are never measured from the DOM, so a committed resize has to
  // invalidate the size cache by hand.
  useEffect(() => {
    columnVirtualizer.measure();
  }, [columnWidths, visibleColumns.length, columnVirtualizer]);

  // Scroll to and highlight a column when highlightedColumnName changes (sidebar double-click)
  useEffect(() => {
    if (!highlightedColumnName) return;
    if (highlightedColumnName === processedHighlightRef.current) return;
    processedHighlightRef.current = highlightedColumnName;

    const visIdx = visibleColumns.findIndex((col) => col.name === highlightedColumnName);
    if (visIdx < 0) return;

    setHighlightedColIndex(visibleColIndexMap[visIdx]);
    columnVirtualizer.scrollToIndex(visIdx, { align: 'start' });

    // Clear highlight after 2.5s and notify parent
    const timer = setTimeout(() => {
      setHighlightedColIndex(null);
      onHighlightDone?.();
    }, 2500);
    return () => clearTimeout(timer);
  }, [highlightedColumnName, visibleColumns, visibleColIndexMap, columnVirtualizer, onHighlightDone]);

  // Worker-based filter/sort for large datasets
  const activeTabId = useQueryStore((s) => s.activeTabId);
  // Short-circuits when an explicit `data` prop is supplied, so unrelated active-tab
  // result updates don't re-render grids that aren't sourcing from the active tab.
  const tabResult = useResultStore((s) => (explicitData ? undefined : (activeTabId ? s.results[activeTabId] : undefined)));
  // Columnar data — primary data source for rendering
  const { data: columnarData, rowCount: columnarRowCount } = resolveColumnarSource(
    explicitData,
    explicitRowCount,
    tabResult?.data,
    tabResult?.rowCount,
    result.rows.length,
  );
  const { filteredIndices: workerFilteredIndices, sortedIndices: workerSortedIndices, useWorker } = useGridWorker(
    columnarData,
    filterText,
    sortColumns,
    columnarRowCount,
    result.query_id,
  );

  // FK navigation: detect FK columns and allow click-to-navigate
  const structureKey = database && table ? `${database}.${table}` : '';
  const tableStructure = useSchemaStore((s) => structureKey ? s.structures[structureKey] : null);
  const fkMap = useMemo(() => {
    const map: Record<string, { refTable: string; refColumn: string; refDb: string | null }> = {};
    if (!tableStructure) return map;
    for (const fk of tableStructure.foreign_keys) {
      fk.columns.forEach((col, i) => {
        map[col] = {
          refTable: fk.referenced_table.table,
          refColumn: fk.referenced_columns[i],
          refDb: fk.referenced_table.database,
        };
      });
    }
    return map;
  }, [tableStructure]);

  const handleFkNavigate = useCallback((colName: string, cellValue: string) => {
    const fk = fkMap[colName];
    if (!fk) return;
    const connId = useConnectionStore.getState().activeConnectionId;
    if (!connId) return;
    const connState = useConnectionStore.getState();
    const dbType = connState.activeConnections.find((c) => c.connectionId === connId)?.config.db_type ?? 'mysql';
    const refDb = fk.refDb ?? database ?? '';
    const pageSize = usePreferencesStore.getState().defaultPageSize;
    const limitClause = pageSize > 0 ? ` LIMIT ${pageSize}` : '';
    const qt = (name: string) => quoteIdentifier(name, dbType);
    const sql = `SELECT * FROM ${qt(fk.refTable)} WHERE ${qt(fk.refColumn)} = '${escapeStringLiteral(cellValue)}'${limitClause}`;
    const tabId = useQueryStore.getState().createTab(`${fk.refTable} → ${cellValue}`, { editorVisible: true });
    useQueryStore.getState().updateSql(tabId, sql);
    useQueryStore.getState().executeQuery(connId, tabId);
  }, [fkMap, database]);

  // Quick filter handler
  const handleQuickFilter = useCallback((colName: string, value: string) => {
    const { setFilterBarOpen, addFilter } = useFilterStore.getState();
    setFilterBarOpen(true);
    addFilter(colName, value);
  }, []);

  const pendingIndex = useMemo(() => buildPendingIndex(pendingChanges), [pendingChanges]);

  const handleInsertRow = useCallback(() => {
    if (!database || !table) return;
    const values: Record<string, any> = {};
    result.columns.forEach((col) => {
      values[col.name] = null;
    });
    addChange({ type: 'insert', table, database, values });
    // Scroll to bottom so the new inserted row is visible
    requestAnimationFrame(() => {
      const container = parentRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    });
  }, [database, table, result.columns, addChange]);

  const insertedRows = pendingIndex.inserts;

  // ─── Data pipeline: filter → sort → paginate ──────────────────────────────

  // Identity index map — reallocated only when the row count changes, so the
  // worker/no-filter path below doesn't rebuild a full array on every keystroke.
  const identityIndexMap = useMemo(
    () => Array.from({ length: columnarRowCount }, (_, i) => i),
    [columnarRowCount],
  );

  // Filter pipeline — works directly on columnar data (no row conversion)
  // When worker is active, return cheap identity array; worker computes real filter
  const filteredIndexMap = useMemo(() => {
    const rowCount = columnarRowCount;
    if (useWorker || !filterText) {
      return identityIndexMap;
    }
    const lowerFilter = filterText.toLowerCase();
    const indices: number[] = [];
    for (let r = 0; r < rowCount; r++) {
      let match = false;
      for (let c = 0; c < columnarData.length; c++) {
        const val = columnarData[c].values[r];
        if (val != null && String(val).toLowerCase().includes(lowerFilter)) {
          match = true;
          break;
        }
      }
      if (match) indices.push(r);
    }
    return indices;
  }, [filterText, columnarData, columnarRowCount, useWorker, identityIndexMap]);

  // Sort pipeline — works directly on columnar data (no row conversion)
  // When worker is active, skip sorting; worker handles it
  const sortedIndexMap = useMemo(() => {
    if (useWorker || sortColumns.length === 0) {
      return filteredIndexMap;
    }

    const indices = [...filteredIndexMap];
    indices.sort((rowA, rowB) => {
      for (const { colIndex, direction } of sortColumns) {
        const col = columnarData[colIndex];
        if (!col) continue;
        const valA = col.values[rowA];
        const valB = col.values[rowB];

        // Nulls last
        if (valA == null && valB != null) return 1;
        if (valA != null && valB == null) return -1;
        if (valA == null && valB == null) continue;

        let cmp = 0;
        if (col.kind === 'Integers' || col.kind === 'Floats') {
          cmp = (valA as number) - (valB as number);
        } else {
          cmp = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
        }

        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });

    return indices;
  }, [filteredIndexMap, sortColumns, columnarData, useWorker]);

  // When using worker, override the filtered/sorted index maps
  const finalSortedIndexMap = useMemo(() => {
    if (!useWorker) return sortedIndexMap;
    if (workerSortedIndices) return workerSortedIndices;
    if (workerFilteredIndices) return workerFilteredIndices;
    return sortedIndexMap;
  }, [useWorker, workerFilteredIndices, workerSortedIndices, sortedIndexMap]);

  // Server-side pagination mode: when browsing a table with onServerPageChange
  const isServerPagination = Boolean(onServerPageChange && table);

  // Paginate — now purely index-based (no row objects)
  const totalSortedRows = finalSortedIndexMap.length;
  const totalPages = isServerPagination
    ? (serverTotalRows != null && pageSize !== Infinity ? Math.max(1, Math.ceil(serverTotalRows / pageSize)) : 1)
    : (pageSize === Infinity ? 1 : Math.max(1, Math.ceil(totalSortedRows / pageSize)));
  const safePage = isServerPagination
    ? (serverPage ?? 0)
    : Math.min(currentPage, totalPages - 1);

  const paginatedIndexMap = useMemo(() => {
    // In server pagination mode, all returned rows are already the current page
    if (isServerPagination) return finalSortedIndexMap;
    if (pageSize === Infinity) return finalSortedIndexMap;
    const start = safePage * pageSize;
    const end = start + pageSize;
    return finalSortedIndexMap.slice(start, end);
  }, [finalSortedIndexMap, safePage, pageSize, isServerPagination]);

  const handleDuplicateRow = useCallback((paginatedIdx: number) => {
    if (!database || !table) return;
    const actualRowIndex = paginatedIndexMap[paginatedIdx];
    const values: Record<string, string | number | boolean | null> = {};
    result.columns.forEach((col, i) => {
      if (col.is_primary_key) {
        values[col.name] = null;
      } else {
        const cell = columnarCellValue(columnarData, i, actualRowIndex);
        if (cell.type === 'Null') {
          values[col.name] = null;
        } else if (cell.type === 'Integer' || cell.type === 'Float') {
          values[col.name] = cell.value as number;
        } else if (cell.type === 'Boolean') {
          values[col.name] = cell.value as boolean;
        } else {
          values[col.name] = formatCell(cell);
        }
      }
    });
    addChange({ type: 'insert', table, database, values });
  }, [database, table, result.columns, columnarData, addChange, paginatedIndexMap]);

  const handlePasteRows = useCallback(async () => {
    if (!database || !table) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return;
      const delimiter = text.includes('\t') ? '\t' : ',';
      for (const line of lines) {
        const cells = line.split(delimiter);
        const values: Record<string, string | number | boolean | null> = {};
        result.columns.forEach((col, i) => {
          if (col.is_primary_key) {
            values[col.name] = null;
          } else if (i < cells.length) {
            const val = cells[i]?.trim();
            if (!val || val.toLowerCase() === 'null') {
              values[col.name] = null;
            } else {
              values[col.name] = val;
            }
          } else {
            values[col.name] = null;
          }
        });
        addChange({ type: 'insert', table, database, values });
      }
    } catch {
      // Clipboard access denied
    }
  }, [database, table, result, addChange]);

  // Reset page when filter/sort changes
  useEffect(() => {
    setCurrentPage(0);
  }, [filterText, sortColumns]);

  // ─── Virtualizer ──────────────────────────────────────────────────────────

  const rowVirtualizer = useVirtualizer({
    count: paginatedIndexMap.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 5,
  });

  // Auto-scroll to focused cell
  useEffect(() => {
    if (focusedCell) {
      rowVirtualizer.scrollToIndex(focusedCell.row, { align: 'auto' });
    }
  }, [focusedCell?.row, rowVirtualizer]);

  // Horizontal counterpart — mandatory now that off-window columns unmount:
  // keyboard nav would otherwise move focus onto a cell that does not exist.
  useEffect(() => {
    if (!focusedCell) return;
    const visIdx = visibleColIndexMap.indexOf(focusedCell.col);
    if (visIdx < 0) return;
    columnVirtualizer.scrollToIndex(visIdx, { align: 'auto' });
  }, [focusedCell?.col, visibleColIndexMap, columnVirtualizer]);

  // Focus input on edit — deps scoped to cell identity only, not value,
  // to avoid re-selecting text on every keystroke.
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      if (editingCell.cursorAtEnd) {
        const len = editInputRef.current.value.length;
        editInputRef.current.setSelectionRange(len, len);
      } else {
        editInputRef.current.select();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingCell?.rowIndex, editingCell?.colIndex, editingCell?.cursorAtEnd]);

  // Keep resize snapshot ref current for the [] effect closure
  resizeSnapshotRef.current = { visibleColumns, visibleColIndexMap, columnWidths };

  // Global mouseup for drag selection + column resize
  useEffect(() => {
    const handleMouseUp = () => {
      if (isDraggingRef.current) isDraggingRef.current = false;
      if (isCellDraggingRef.current) isCellDraggingRef.current = false;
      if (resizingRef.current) {
        // Cancel any pending rAF
        if (resizeRafRef.current) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = 0;
        }
        // Commit final width from CSS variable to React state
        const container = parentRef.current;
        const colIdx = resizingRef.current.colIndex;
        if (container) {
          const cssVal = container.style.getPropertyValue(`--col-${colIdx}-w`);
          const finalWidth = parseInt(cssVal, 10);
          if (finalWidth) {
            setColumnWidths((prev) => ({ ...prev, [colIdx]: finalWidth }));
          }
          // Clean up all resize CSS variables
          container.style.removeProperty(`--col-${colIdx}-w`);
          container.style.removeProperty('--total-content-width');
        }
        resizingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (resizingRef.current) {
        const clientX = e.clientX;
        if (resizeRafRef.current) return; // Already have a pending frame
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = 0;
          if (!resizingRef.current) return;
          const delta = clientX - resizingRef.current.startX;
          const newWidth = Math.max(MIN_COL_WIDTH, resizingRef.current.startWidth + delta);
          const container = parentRef.current;
          if (container) {
            container.style.setProperty(`--col-${resizingRef.current.colIndex}-w`, `${newWidth}px`);
            // Also update total content width CSS variable for scroll container
            const snap = resizeSnapshotRef.current;
            let total = ROW_NUM_WIDTH;
            const colCount = snap.visibleColumns.length;
            for (let i = 0; i < colCount; i++) {
              const idx = snap.visibleColIndexMap[i];
              total += idx === resizingRef.current.colIndex
                ? newWidth
                : (snap.columnWidths[idx] ?? DEFAULT_COL_WIDTH);
            }
            container.style.setProperty('--total-content-width', `${total}px`);
          }
        });
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  // ─── Column resize ─────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const currentWidth = columnWidths[colIndex] ?? DEFAULT_COL_WIDTH;
    resizingRef.current = { colIndex, startX: e.clientX, startWidth: currentWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  // Returns a CSS width that reads from a CSS custom property during resize,
  // falling back to the React state width. This avoids re-renders during drag.
  const getColWidthStyle = useCallback((colIndex: number): string => {
    const stateWidth = columnWidths[colIndex] ?? DEFAULT_COL_WIDTH;
    return `var(--col-${colIndex}-w, ${stateWidth}px)`;
  }, [columnWidths]);

  // Total content width for horizontal scroll: row-number col + all visible column widths.
  // During resize, the CSS variable --total-content-width overrides this via style binding.
  const totalContentWidth = useMemo(() => {
    return ROW_NUM_WIDTH + visibleColumns.reduce((sum, _, visIdx) => {
      const colIdx = visibleColIndexMap[visIdx];
      return sum + (columnWidths[colIdx] ?? DEFAULT_COL_WIDTH);
    }, 0);
  }, [visibleColumns, visibleColIndexMap, columnWidths]);

  // CSS minWidth that reads from the CSS variable during resize,
  // falling back to the computed React state total.
  const totalWidthStyle = useMemo(
    () => `var(--total-content-width, ${totalContentWidth}px)`,
    [totalContentWidth],
  );

  // ─── Column sorting ────────────────────────────────────────────────────────

  const handleHeaderClick = useCallback((colIndex: number, shiftKey: boolean) => {
    setSortColumns((prev) => {
      const existingIdx = prev.findIndex((s) => s.colIndex === colIndex);
      let next: SortColumn[];
      if (existingIdx !== -1) {
        const existing = prev[existingIdx];
        if (existing.direction === 'asc') {
          next = [...prev];
          next[existingIdx] = { ...existing, direction: 'desc' };
        } else {
          next = prev.filter((_, i) => i !== existingIdx);
        }
      } else if (shiftKey) {
        next = [...prev, { colIndex, direction: 'asc' }];
      } else {
        next = [{ colIndex, direction: 'asc' }];
      }

      // Server-side sort when browsing a table
      if (onServerSort) {
        const sorts: SortRequest[] = next.map((s) => ({
          column: result.columns[s.colIndex].name,
          direction: s.direction,
        }));
        onServerSort(sorts);
      }

      return next;
    });
  }, [onServerSort, result.columns]);

  const getSortDirection = useCallback((colIndex: number): 'asc' | 'desc' | null => {
    const found = sortColumns.find((s) => s.colIndex === colIndex);
    return found?.direction ?? null;
  }, [sortColumns]);

  // ─── Row interaction ───────────────────────────────────────────────────────

  // Start editing a cell — shared by click, double-click, and keyboard triggers
  const startEditingCell = useCallback(
    (rowIndex: number, colIndex: number, initialValue?: string) => {
      const actualRowIndex = paginatedIndexMap[rowIndex];
      const cell = columnarCellValue(columnarData, colIndex, actualRowIndex);
      const isNull = cell.type === 'Null';
      const value = initialValue ?? (isNull ? '' : formatCell(cell));
      setEditingCell({
        rowIndex,
        colIndex,
        value,
        isNull: isNull && initialValue == null,
        cursorAtEnd: initialValue != null,
      });
    },
    [paginatedIndexMap, columnarData],
  );

  // Everything the body handlers below read at call time. They must never take
  // a dependency on these values directly: their identities feed the one
  // `handlers` object each GridRow/GridCell memo compares against.
  const bodyState = {
    editingCell, focusedCell, cellSelection, selectedRows, lastSelectedRow, dragStartRow,
    pendingIndex, columnarData, columns: result.columns, fkMap, database, table,
    startEditingCell, handleFkNavigate,
  };
  const bodyStateRef = useRef(bodyState);
  // Published after commit rather than during render, so a concurrent render
  // that never commits (the deferred filter pass) cannot make the handlers
  // disagree with the rows the user is actually clicking.
  useLayoutEffect(() => {
    bodyStateRef.current = bodyState;
  });

  // Row gutter click → row selection only (left click)
  const handleRowGutterMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { editingCell, lastSelectedRow } = bodyStateRef.current;
    if (editingCell) return;
    if (e.button === 2) return;
    e.stopPropagation();
    const rowIndex = Number(e.currentTarget.dataset.vrow);
    setCellSelection(EMPTY_SELECTION);
    if (e.shiftKey && lastSelectedRow !== null) {
      const start = Math.min(lastSelectedRow, rowIndex);
      const end = Math.max(lastSelectedRow, rowIndex);
      const next = new Set<number>();
      for (let i = start; i <= end; i++) next.add(i);
      setSelectedRows(next);
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (next.has(rowIndex)) next.delete(rowIndex);
        else next.add(rowIndex);
        return next;
      });
    } else {
      isDraggingRef.current = true;
      setDragStartRow(rowIndex);
      setSelectedRows(new Set([rowIndex]));
    }
    setLastSelectedRow(rowIndex);
  }, []);

  const handleRowMouseEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { dragStartRow } = bodyStateRef.current;
    if (!isDraggingRef.current || dragStartRow === null) return;
    const rowIndex = Number(e.currentTarget.dataset.vrow);
    const start = Math.min(dragStartRow, rowIndex);
    const end = Math.max(dragStartRow, rowIndex);
    const next = new Set<number>();
    for (let i = start; i <= end; i++) next.add(i);
    setSelectedRows(next);
    setCellSelection(EMPTY_SELECTION);
  }, []);

  // Row-level context (gutter area) — only if no cell selection
  const handleRowContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    const { cellSelection, selectedRows } = bodyStateRef.current;
    const rowIndex = Number(e.currentTarget.dataset.vrow);
    if (isSelectionEmpty(cellSelection) && !selectedRows.has(rowIndex)) {
      setSelectedRows(new Set([rowIndex]));
      setLastSelectedRow(rowIndex);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, rowIndex, colIndex: 0 });
  }, []);

  // Cell click → cell selection + start drag (left click only)
  const handleCellMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { editingCell, focusedCell, database, table, startEditingCell } = bodyStateRef.current;
    if (editingCell) return;
    if (e.button === 2) return; // right-click handled by onContextMenu
    e.stopPropagation();
    const rowIndex = Number(e.currentTarget.dataset.vrow);
    const colIndex = Number(e.currentTarget.dataset.col);
    // Single click on already-focused cell → start editing (spreadsheet UX)
    if (
      focusedCell?.row === rowIndex &&
      focusedCell?.col === colIndex &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      database &&
      table
    ) {
      startEditingCell(rowIndex, colIndex);
      return;
    }
    setSelectedRows(new Set());
    if (e.shiftKey) {
      // Range select: pure rectangle extension from the anchor
      setCellSelection((sel) => extendTo(sel, rowIndex, colIndex));
    } else if (e.ctrlKey || e.metaKey) {
      setCellSelection((sel) => toggleCell(sel, rowIndex, colIndex));
    } else {
      isCellDraggingRef.current = true;
      setCellSelection(selectSingle(rowIndex, colIndex));
    }
    setFocusedColIndex(colIndex);
    setFocusedCell({ row: rowIndex, col: colIndex });
  }, []);

  // Cell drag → rectangular selection (O(1): moves focus, keeps anchor)
  const handleCellMouseEnter = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isCellDraggingRef.current) return;
    const rowIndex = Number(e.currentTarget.dataset.vrow);
    const colIndex = Number(e.currentTarget.dataset.col);
    setCellSelection((sel) => extendTo(sel, rowIndex, colIndex));
  }, []);

  const handleCellContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const { cellSelection, selectedRows } = bodyStateRef.current;
    const rowIndex = Number(e.currentTarget.dataset.vrow);
    const colIndex = Number(e.currentTarget.dataset.col);
    if (!isSelectionEmpty(cellSelection)) {
      // If right-clicking outside current cell selection, select just this cell
      if (!isCellInSelection(cellSelection, rowIndex, colIndex)) {
        setCellSelection(selectSingle(rowIndex, colIndex));
        setSelectedRows(new Set());
      }
      // Otherwise keep current cell selection
    } else {
      // No cell selection — fallback to row selection
      if (!selectedRows.has(rowIndex)) {
        setSelectedRows(new Set([rowIndex]));
        setLastSelectedRow(rowIndex);
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY, rowIndex, colIndex });
  }, []);

  const handleCellDoubleClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const { pendingIndex, startEditingCell } = bodyStateRef.current;
    const actualRowIndex = Number(e.currentTarget.dataset.arow);
    if (pendingIndex.deletedRows.has(actualRowIndex)) return;
    startEditingCell(Number(e.currentTarget.dataset.vrow), Number(e.currentTarget.dataset.col));
  }, []);

  const handleCellValueClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const { columns, fkMap, columnarData, handleFkNavigate } = bodyStateRef.current;
    const colIndex = Number(e.currentTarget.dataset.col);
    const col = columns[colIndex];
    if (!col || !fkMap[col.name]) return;
    e.stopPropagation();
    const actualRowIndex = Number(e.currentTarget.dataset.arow);
    handleFkNavigate(col.name, formatCell(columnarCellValue(columnarData, colIndex, actualRowIndex)));
  }, []);

  const handlers = useMemo<GridBodyHandlers>(() => ({
    onCellMouseDown: handleCellMouseDown,
    onCellMouseEnter: handleCellMouseEnter,
    onCellContextMenu: handleCellContextMenu,
    onCellDoubleClick: handleCellDoubleClick,
    onCellValueClick: handleCellValueClick,
    onRowMouseEnter: handleRowMouseEnter,
    onRowContextMenu: handleRowContextMenu,
    onRowGutterMouseDown: handleRowGutterMouseDown,
  }), [
    handleCellMouseDown, handleCellMouseEnter, handleCellContextMenu, handleCellDoubleClick,
    handleCellValueClick, handleRowMouseEnter, handleRowContextMenu, handleRowGutterMouseDown,
  ]);

  const commitEdit = useCallback(() => {
    if (!editingCell) {
      setEditingCell(null);
      return;
    }
    const { rowIndex, colIndex, isNull } = editingCell;
    const actualRowIndex = paginatedIndexMap[rowIndex];
    const column = result.columns[colIndex];
    const cell = columnarCellValue(columnarData, colIndex, actualRowIndex);
    const oldValue: string | number | boolean | null = cell.type === 'Null' ? null : formatCell(cell);
    const newValue: string | number | boolean | null = isNull ? null : editingCell.value;
    if (oldValue === newValue) {
      setEditingCell(null);
      return;
    }
    if (database && table) {
      const primaryKeys: Record<string, string | number | boolean | null> = {};
      result.columns.forEach((col, i) => {
        const isPk = schemaPrimaryKeys ? schemaPrimaryKeys.has(col.name) : col.is_primary_key;
        if (isPk) primaryKeys[col.name] = formatColumnarCell(columnarData, i, actualRowIndex);
      });
      if (Object.keys(primaryKeys).length > 0) {
        addChange({
          type: 'edit', table, database, rowIndex: actualRowIndex, primaryKeys,
          column: column.name, oldValue, newValue,
        });
      }
    }
    setEditingCell(null);
  }, [editingCell, result.columns, columnarData, database, table, addChange, paginatedIndexMap, schemaPrimaryKeys]);

  const cancelEdit = useCallback(() => setEditingCell(null), []);

  // Commit current edit and move to an adjacent cell
  const commitAndMove = useCallback((direction: 'right' | 'left' | 'down') => {
    if (!editingCell) return;
    // Commit first (inline logic to avoid async timing issues)
    const { rowIndex, colIndex, isNull } = editingCell;
    const actualRowIndex = paginatedIndexMap[rowIndex];
    const column = result.columns[colIndex];
    const cell = columnarCellValue(columnarData, colIndex, actualRowIndex);
    const oldValue: string | number | boolean | null = cell.type === 'Null' ? null : formatCell(cell);
    const newValue: string | number | boolean | null = isNull ? null : editingCell.value;
    if (oldValue !== newValue && database && table) {
      const primaryKeys: Record<string, string | number | boolean | null> = {};
      result.columns.forEach((col, i) => {
        const isPk = schemaPrimaryKeys ? schemaPrimaryKeys.has(col.name) : col.is_primary_key;
        if (isPk) primaryKeys[col.name] = formatColumnarCell(columnarData, i, actualRowIndex);
      });
      if (Object.keys(primaryKeys).length > 0) {
        addChange({ type: 'edit', table, database, rowIndex: actualRowIndex, primaryKeys, column: column.name, oldValue, newValue });
      }
    }

    // Find next cell
    const visIdx = visibleColIndexMap.indexOf(colIndex);
    let nextRow = rowIndex;
    let nextVisIdx = visIdx;

    if (direction === 'right') {
      nextVisIdx = visIdx + 1;
      if (nextVisIdx >= visibleColumns.length) { nextVisIdx = 0; nextRow = rowIndex + 1; }
    } else if (direction === 'left') {
      nextVisIdx = visIdx - 1;
      if (nextVisIdx < 0) { nextVisIdx = visibleColumns.length - 1; nextRow = rowIndex - 1; }
    } else {
      nextRow = rowIndex + 1;
    }

    if (nextRow >= 0 && nextRow < paginatedIndexMap.length) {
      const nextColIdx = visibleColIndexMap[nextVisIdx];
      const nextActualRow = paginatedIndexMap[nextRow];
      const nextCell = columnarCellValue(columnarData, nextColIdx, nextActualRow);
      const nextIsNull = nextCell.type === 'Null';
      setEditingCell({ rowIndex: nextRow, colIndex: nextColIdx, value: nextIsNull ? '' : formatCell(nextCell), isNull: nextIsNull });
    } else {
      setEditingCell(null);
    }
  }, [editingCell, paginatedIndexMap, columnarData, result.columns, database, table, addChange, visibleColumns, visibleColIndexMap, schemaPrimaryKeys]);

  const handleEditorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingCell((prev) => (prev ? { ...prev, value: e.target.value, isNull: false } : null));
  }, []);

  const handleEditorToggleNull = useCallback(() => {
    setEditingCell((prev) => (prev ? { ...prev, isNull: !prev.isNull, value: '' } : null));
  }, []);

  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') { e.preventDefault(); commitAndMove(e.shiftKey ? 'left' : 'right'); return; }
    if (e.key === 'Enter') { commitAndMove('down'); return; }
    if (e.key === 'Escape') cancelEdit();
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      commitEdit();
      window.dispatchEvent(new CustomEvent('vasodb:commit'));
      return;
    }
    e.stopPropagation();
  }, [commitAndMove, cancelEdit, commitEdit]);

  const editorContext = useMemo<GridEditorContextValue | null>(
    () => (editingCell
      ? {
          value: editingCell.value,
          isNull: Boolean(editingCell.isNull),
          inputRef: editInputRef,
          onChange: handleEditorChange,
          onKeyDown: handleEditorKeyDown,
          onBlur: commitEdit,
          onToggleNull: handleEditorToggleNull,
        }
      : null),
    [editingCell, handleEditorChange, handleEditorKeyDown, commitEdit, handleEditorToggleNull],
  );

  // Position only — the live editor value travels by context, so a keystroke
  // never changes any GridRow prop.
  const editingPosition = useMemo(
    () => (editingCell ? { rowIndex: editingCell.rowIndex, colIndex: editingCell.colIndex } : null),
    [editingCell?.rowIndex, editingCell?.colIndex],
  );

  const handleDeleteRow = useCallback((paginatedIdx: number) => {
    if (!database || !table) return;
    const actualRowIndex = paginatedIndexMap[paginatedIdx];
    const primaryKeys: Record<string, string | number | boolean | null> = {};
    const originalRow: Record<string, string | number | boolean | null> = {};
    result.columns.forEach((col, i) => {
      const formatted = formatColumnarCell(columnarData, i, actualRowIndex);
      const isPk = schemaPrimaryKeys ? schemaPrimaryKeys.has(col.name) : col.is_primary_key;
      if (isPk) primaryKeys[col.name] = formatted;
      originalRow[col.name] = formatted;
    });
    if (Object.keys(primaryKeys).length === 0) return;
    addChange({ type: 'delete', table, database, rowIndex: actualRowIndex, primaryKeys, originalRow });
    setContextMenu(null);
  }, [database, table, result.columns, columnarData, addChange, paginatedIndexMap, schemaPrimaryKeys]);

  const allColIndexes = useMemo(() => result.columns.map((_, i) => i), [result.columns]);

  /** Slice of the columnar data for paginated row indexes (translated to actual indexes) and column indexes. */
  const buildSlice = useCallback((rowIdxs: number[], colIdxs: number[]): ColumnarSlice => ({
    columns: colIdxs.map((i) => result.columns[i]),
    colIndexes: colIdxs,
    data: columnarData,
    rowIndexes: rowIdxs.map((ri) => paginatedIndexMap[ri]),
  }), [result.columns, columnarData, paginatedIndexMap]);

  /** What a context-menu copy acts on: the cell selection, else the row selection, else the clicked row. */
  const buildContextSlice = useCallback((contextRowIndex: number): ColumnarSlice => {
    if (!isSelectionEmpty(cellSelection)) {
      const parsed = materializeCells(cellSelection);
      const colIdxs = [...new Set(parsed.map((p) => p.col))].sort((a, b) => a - b);
      const rowIdxs = [...new Set(parsed.map((p) => p.row))].sort((a, b) => a - b);
      return buildSlice(rowIdxs, colIdxs);
    }
    const rowIdxs = selectedRows.size > 0 ? [...selectedRows].sort((a, b) => a - b) : [contextRowIndex];
    return buildSlice(rowIdxs, allColIndexes);
  }, [cellSelection, selectedRows, allColIndexes, buildSlice]);

  // Clipboard paths stay synchronous up to `copyFormatted`: awaiting first would
  // drop the user gesture WKWebView requires for a clipboard write.
  const copySelection = useCallback(() => {
    const tableName = table || 'table';
    // Cell selection
    if (!isSelectionEmpty(cellSelection)) {
      const parsed = materializeCells(cellSelection);
      if (parsed.length === 1) {
        // Single cell
        const { row: rowIndex, col: colIndex } = parsed[0];
        const actualRowIndex = paginatedIndexMap[rowIndex];
        if (actualRowIndex == null) return;
        const col = result.columns[colIndex];
        const cell = columnarCellValue(columnarData, colIndex, actualRowIndex);
        if (defaultCopyFormat === 'json') {
          copyToClipboard(copyCellAsJson(col.name, cell));
        } else {
          copyToClipboard(copyCellAsText(cell));
        }
        return;
      }
      const colIdxs = [...new Set(parsed.map((p) => p.col))].sort((a, b) => a - b);
      const rowIdxs = [...new Set(parsed.map((p) => p.row))].sort((a, b) => a - b);
      copyFormatted(buildSlice(rowIdxs, colIdxs), defaultCopyFormat, { tableName });
      return;
    }
    // Row selection
    if (selectedRows.size === 0) return;
    const rowIdxs = [...selectedRows].sort((a, b) => a - b);
    copyFormatted(buildSlice(rowIdxs, allColIndexes), defaultCopyFormat, { tableName });
  }, [cellSelection, selectedRows, result.columns, columnarData, paginatedIndexMap, defaultCopyFormat, buildSlice, allColIndexes, table]);

  const copyContextAs = useCallback((contextRowIndex: number, format: CopyFormat) => {
    copyFormatted(buildContextSlice(contextRowIndex), format, { tableName: table || 'table' });
  }, [buildContextSlice, table]);

  // ─── Grid keyboard navigation ──────────────────────────────────────────────

  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!focusedCell || editingCell) return false;

    const maxRow = paginatedIndexMap.length - 1;
    const maxCol = visibleColIndexMap.length - 1;
    let { row, col } = focusedCell;

    // Find the visible column position for current focusedCell.col
    let visIdx = visibleColIndexMap.indexOf(col);
    if (visIdx === -1) visIdx = 0;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        row = Math.max(0, row - 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        row = Math.min(maxRow, row + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        visIdx = Math.max(0, visIdx - 1);
        col = visibleColIndexMap[visIdx];
        break;
      case 'ArrowRight':
        e.preventDefault();
        visIdx = Math.min(maxCol, visIdx + 1);
        col = visibleColIndexMap[visIdx];
        break;
      case 'Home':
        e.preventDefault();
        col = visibleColIndexMap[0];
        break;
      case 'End':
        e.preventDefault();
        col = visibleColIndexMap[maxCol];
        break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) {
          if (visIdx > 0) {
            visIdx -= 1;
          } else {
            visIdx = maxCol;
            if (row > 0) row -= 1;
          }
        } else {
          if (visIdx < maxCol) {
            visIdx += 1;
          } else {
            visIdx = 0;
            if (row < maxRow) row += 1;
          }
        }
        col = visibleColIndexMap[visIdx];
        break;
      case 'Escape':
        setFocusedCell(null);
        setCellSelection(EMPTY_SELECTION);
        return true;
      case 'F2':
        e.preventDefault();
        if (database && table) startEditingCell(row, col);
        return true;
      case 'Enter':
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && database && table) {
          e.preventDefault();
          startEditingCell(row, col);
          return true;
        }
        return false;
      default:
        return false;
    }

    setFocusedCell({ row, col });
    // Sync cell selection so copy and other operations work
    if (!e.shiftKey || e.key === 'Tab' || e.key === 'Home' || e.key === 'End') {
      setCellSelection(selectSingle(row, col));
    } else {
      setCellSelection((sel) => extendTo(sel, row, col));
    }
    setFocusedColIndex(col);
    setSelectedRows(new Set());
    return true;
  }, [focusedCell, editingCell, paginatedIndexMap.length, visibleColIndexMap, startEditingCell, database, table]);

  // ─── Keyboard ──────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const { getBinding } = useShortcutStore.getState();
    if (matchesBinding(e, getBinding('grid.copy'))) {
      e.preventDefault();
      copySelection();
      return;
    }
    if (matchesBinding(e, getBinding('grid.selectAll'))) {
      e.preventDefault();
      setCellSelection(EMPTY_SELECTION);
      const all = new Set<number>();
      for (let i = 0; i < paginatedIndexMap.length; i++) all.add(i);
      setSelectedRows(all);
      return;
    }
    if (matchesBinding(e, getBinding('grid.paste'))) {
      e.preventDefault();
      handlePasteRows();
      return;
    }
    if (matchesBinding(e, getBinding('grid.duplicate'))) {
      e.preventDefault();
      if (selectedRows.size === 1 && database && table) {
        handleDuplicateRow([...selectedRows][0]);
      }
      return;
    }
    if (e.key === 'Escape') {
      if (contextMenu) { setContextMenu(null); return; }
      if (editingCell) cancelEdit();
      else if (focusedCell) { setFocusedCell(null); setCellSelection(EMPTY_SELECTION); }
      else if (!isSelectionEmpty(cellSelection)) { setCellSelection(EMPTY_SELECTION); }
      else setSelectedRows(new Set());
      return;
    }
    // Grid keyboard navigation (arrow keys, Home, End, Tab when focusedCell is set)
    if (focusedCell && handleGridKeyDown(e)) return;
    // Quick Look
    if (matchesBinding(e, getBinding('grid.quickLook')) && !editingCell) {
      e.preventDefault();
      if (selectedRows.size === 1) {
        const rowIdx = [...selectedRows][0];
        const actualRowIndex = paginatedIndexMap[rowIdx];
        if (actualRowIndex != null) {
          const colIdx = focusedColIndex < result.columns.length ? focusedColIndex : 0;
          const col = result.columns[colIdx];
          const cell = columnarCellValue(columnarData, colIdx, actualRowIndex);
          setQuickLookCell({ cell, columnName: col.name, columnType: col.native_type });
        }
      }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (cellSelection.focus && !editingCell) {
        e.preventDefault();
        const nextCol = e.key === 'ArrowRight'
          ? Math.min(cellSelection.focus.col + 1, result.columns.length - 1)
          : Math.max(cellSelection.focus.col - 1, 0);
        const next = { row: cellSelection.focus.row, col: nextCol };
        if (e.shiftKey) {
          setCellSelection((sel) => extendTo(sel, next.row, next.col));
        } else {
          setCellSelection(selectSingle(next.row, next.col));
        }
        setFocusedColIndex(nextCol);
        return;
      }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (cellSelection.focus && !isSelectionEmpty(cellSelection)) {
        const nextRow = e.key === 'ArrowDown'
          ? Math.min(cellSelection.focus.row + 1, paginatedIndexMap.length - 1)
          : Math.max(cellSelection.focus.row - 1, 0);
        const next = { row: nextRow, col: cellSelection.focus.col };
        if (e.shiftKey) {
          setCellSelection((sel) => extendTo(sel, next.row, next.col));
        } else {
          setCellSelection(selectSingle(next.row, next.col));
          setSelectedRows(new Set());
        }
        return;
      }
      const current = lastSelectedRow ?? -1;
      const next = e.key === 'ArrowDown'
        ? Math.min(current + 1, paginatedIndexMap.length - 1)
        : Math.max(current - 1, 0);
      if (e.shiftKey) {
        setSelectedRows((prev) => {
          const s = new Set(prev);
          s.add(next);
          return s;
        });
      } else {
        setSelectedRows(new Set([next]));
      }
      setLastSelectedRow(next);
      return;
    }
    // Typing a printable character on a focused cell → start editing with that char
    if (
      focusedCell &&
      !editingCell &&
      database &&
      table &&
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      e.preventDefault();
      startEditingCell(focusedCell.row, focusedCell.col, e.key);
      return;
    }
  }, [copySelection, paginatedIndexMap, columnarData, editingCell, cancelEdit, lastSelectedRow, contextMenu, focusedColIndex, result.columns, selectedRows, cellSelection, database, table, handleDuplicateRow, handlePasteRows, focusedCell, handleGridKeyDown, startEditingCell]);

  // ─── Export ────────────────────────────────────────────────────────────────

  const exportData = useCallback(async (format: 'csv' | 'json' | 'sql') => {
    const rowIndexes = selectedRows.size > 0
      ? [...selectedRows].sort((a, b) => a - b).map((i) => paginatedIndexMap[i])
      : paginatedIndexMap;
    const slice: ColumnarSlice = {
      columns: result.columns,
      colIndexes: allColIndexes,
      data: columnarData,
      rowIndexes,
    };
    const content = await runExport(slice, format === 'sql' ? 'insert' : format, { tableName: table ?? 'table_name' });
    await ipc.saveSqlFile(content, `${table ?? 'export'}.${format}`);
  }, [selectedRows, result.columns, columnarData, paginatedIndexMap, table, allColIndexes]);

  // ─── Pagination helpers ────────────────────────────────────────────────────

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(0);
    // Persist to preferences store (0 = All)
    usePreferencesStore.getState().setPreference('defaultPageSize', size === Infinity ? 0 : size);
    // In server mode, re-fetch page 0 with the new size
    if (isServerPagination) {
      onServerPageChange?.(0, size === Infinity ? 0 : size);
    }
  }, [isServerPagination, onServerPageChange]);

  const handleServerPageNav = useCallback((page: number) => {
    if (isServerPagination) {
      onServerPageChange?.(page, pageSize === Infinity ? 0 : pageSize);
    } else {
      setCurrentPage(page);
    }
  }, [isServerPagination, onServerPageChange, pageSize]);

  const pageStart = (pageSize === Infinity || !isFinite(pageSize))
    ? 0
    : safePage * pageSize;
  const pageEnd = isServerPagination
    ? (pageSize === Infinity ? totalSortedRows : Math.min(pageStart + pageSize, serverTotalRows ?? totalSortedRows))
    : (pageSize === Infinity ? totalSortedRows : Math.min(pageStart + pageSize, totalSortedRows));
  const displayTotalRows = isServerPagination ? (serverTotalRows ?? totalSortedRows) : totalSortedRows;

  // ─── Column window ─────────────────────────────────────────────────────────
  // Derived once per render and handed to every column loop as four numbers, so
  // a horizontal scroll that does not move the window re-renders nothing.
  const columnItems = columnVirtualizer.getVirtualItems();
  const rangeStart = columnItems.length > 0 ? columnItems[0].index : 0;
  const rangeEnd = columnItems.length > 0 ? columnItems[columnItems.length - 1].index + 1 : 0;
  const editingVisIdx = editingPosition ? visibleColIndexMap.indexOf(editingPosition.colIndex) : -1;
  const focusedVisIdx = focusedCell ? visibleColIndexMap.indexOf(focusedCell.col) : -1;
  // The editing pin is unconditional — unmounting the editor would destroy the
  // edit session. The focus pin is not: focus survives in state, so unmounting
  // its cell costs only an off-screen ring, and pinning it unconditionally would
  // let a focus left far behind hold the window open across every column between.
  const focusPin = focusedVisIdx >= 0
    && focusedVisIdx >= rangeStart - FOCUS_PIN_SLACK
    && focusedVisIdx < rangeEnd + FOCUS_PIN_SLACK
    ? focusedVisIdx
    : null;
  const { colStart, colEnd, leftSpacerWidth, rightSpacerWidth } = computeColumnWindow({
    rangeStart,
    rangeEnd,
    pinnedVisIdxs: [editingVisIdx >= 0 ? editingVisIdx : null, focusPin],
    widths: columnWidthsByVisIdx,
  });
  const windowedColumns = visibleColumns.slice(colStart, colEnd);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
    <div
      ref={parentRef}
      role="grid"
      aria-label="Query results"
      aria-rowcount={columnarRowCount}
      aria-colcount={visibleColumns.length}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex-1 select-none overflow-auto bg-background outline-none focus:outline-none"
      onScroll={() => { if (contextMenu) setContextMenu(null); }}
      onClick={(e) => {
        if (e.target === parentRef.current) { setSelectedRows(new Set()); setCellSelection(EMPTY_SELECTION); }
      }}
    >
      {/* Column headers */}
      <div role="row" aria-rowindex={1} className="sticky top-0 z-10 flex border-b-2 border-border bg-muted" style={{ minWidth: totalWidthStyle }}>
        <div role="columnheader" className="flex w-[50px] shrink-0 items-center justify-center border-r border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          #
        </div>
        <div aria-hidden style={{ width: leftSpacerWidth, flexShrink: 0 }} />
        {windowedColumns.map((col, i) => {
          const visIdx = colStart + i;
          const colIdx = visibleColIndexMap[visIdx];
          const sortDir = getSortDirection(colIdx);

          return (
            <div
              key={col.name}
              role="columnheader"
              aria-sort={getSortDirection(colIdx) === 'asc' ? 'ascending' : getSortDirection(colIdx) === 'desc' ? 'descending' : 'none'}
              className={cn(
                'relative flex shrink-0 items-center gap-1 border-r border-border px-2 py-1.5 cursor-pointer hover:bg-accent/30 transition-colors duration-300',
                highlightedColIndex === colIdx && 'bg-primary/20 ring-1 ring-inset ring-primary/40',
              )}
              style={{ width: getColWidthStyle(colIdx) }}
              onClick={(e) => handleHeaderClick(colIdx, e.shiftKey)}
            >
              {col.is_primary_key && (
                <Key className="h-3 w-3 shrink-0 text-primary" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-foreground">
                  {col.name}
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="secondary" className="h-3.5 rounded px-1 py-0 text-[10px] font-normal">
                    {formatDataType(col.data_type)}
                  </Badge>
                  {col.nullable && (
                    <span className="text-[10px] text-muted-foreground">null</span>
                  )}
                </div>
              </div>
              {/* Sort indicator */}
              <span className="shrink-0 text-muted-foreground">
                {sortDir === 'asc' ? (
                  <ChevronUp className="h-3 w-3 text-primary" />
                ) : sortDir === 'desc' ? (
                  <ChevronDown className="h-3 w-3 text-primary" />
                ) : (
                  <ChevronsUpDown className="h-3 w-3 opacity-0 group-hover:opacity-50" />
                )}
              </span>
              {/* Resize handle */}
              <div
                className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
                onMouseDown={(e) => handleResizeStart(e, colIdx)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          );
        })}
        <div aria-hidden style={{ width: rightSpacerWidth, flexShrink: 0 }} />
      </div>

      {/* Filter bar */}
      <div className="sticky top-[calc(2rem+8px)] z-10 flex items-center gap-2 border-b border-border bg-card px-2 py-1" style={{ minWidth: totalWidthStyle }}>
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          placeholder="Filter rows..."
          value={filterInput}
          onChange={(e) => setFilterInput(e.target.value)}
        />
        {filterInput && (
          <button onClick={() => setFilterInput('')} className="text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
        <span className="text-[10px] text-muted-foreground">
          {totalSortedRows}/{columnarRowCount}
        </span>
      </div>

      {/* Virtualized body */}
      <div
        className="relative"
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, minWidth: totalWidthStyle, contain: 'layout paint' }}
      >
        <GridEditorContext.Provider value={editorContext}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const actualRowIndex = paginatedIndexMap[virtualRow.index];

            return (
              <GridRow
                key={virtualRow.key}
                virtualIndex={virtualRow.index}
                actualRowIndex={actualRowIndex}
                displayIndex={pageStart + virtualRow.index}
                start={virtualRow.start}
                size={virtualRow.size}
                isOdd={virtualRow.index % 2 === 1}
                isSelected={selectedRows.has(virtualRow.index)}
                rowDeleted={pendingIndex.deletedRows.has(actualRowIndex)}
                alternatingRowColors={alternatingRowColors}
                totalWidthStyle={totalWidthStyle}
                visibleColumns={visibleColumns}
                visibleColIndexMap={visibleColIndexMap}
                colStart={colStart}
                colEnd={colEnd}
                leftSpacerWidth={leftSpacerWidth}
                rightSpacerWidth={rightSpacerWidth}
                columnarData={columnarData}
                cellSelection={cellSelection}
                pendingIndex={pendingIndex}
                editingCell={editingPosition}
                focusedCell={focusedCell}
                highlightedColIndex={highlightedColIndex}
                fkMap={fkMap}
                getColWidthStyle={getColWidthStyle}
                handlers={handlers}
              />
            );
          })}
        </GridEditorContext.Provider>
      </div>

      {/* Pending inserted rows */}
      {insertedRows.map((insert, idx) => (
        <div
          key={insert.id}
          className="flex bg-green-500/10 border-b border-border"
          style={{ height: 32, minWidth: totalWidthStyle }}
        >
          <div className="flex w-[50px] shrink-0 items-center justify-center border-r border-border bg-green-500/10 text-[10px] text-green-600">
            +{idx + 1}
          </div>
          <div aria-hidden style={{ width: leftSpacerWidth, flexShrink: 0 }} />
          {windowedColumns.map((col, i) => {
            const colIdx = visibleColIndexMap[colStart + i];
            return (
              <div
                key={col.name}
                className="flex shrink-0 items-center border-r border-border px-2 text-xs text-green-600 dark:text-green-400"
                style={{ width: getColWidthStyle(colIdx) }}
              >
                {insert.values[col.name] === null ? (
                  <span className="italic text-green-400/60">NULL</span>
                ) : (
                  String(insert.values[col.name])
                )}
              </div>
            );
          })}
          <div aria-hidden style={{ width: rightSpacerWidth, flexShrink: 0 }} />
        </div>
      ))}

      </div>

      {/* Footer toolbar — outside scroll container so it never scrolls horizontally */}
      {columnarRowCount > 0 && (
        <div className="flex shrink-0 items-center border-t border-border bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          {/* Left: page size selector + row info */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {PAGE_SIZES.map((size) => (
                <button
                  key={size}
                  onClick={() => handlePageSizeChange(size)}
                  className={cn(
                    'rounded px-1.5 py-0.5',
                    pageSize === size
                      ? 'bg-primary/15 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {size}
                </button>
              ))}
              <button
                onClick={() => handlePageSizeChange(Infinity)}
                className={cn(
                  'rounded px-1.5 py-0.5',
                  pageSize === Infinity
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                All
              </button>
            </div>
            <span className="text-muted-foreground/70">|</span>
            <span>
              {displayTotalRows > 0
                ? `${pageStart + 1}–${pageEnd} of ${displayTotalRows}`
                : '0 rows'}
            </span>
            {!isSelectionEmpty(cellSelection) && (
              <span className="text-primary">
                {selectionSize(cellSelection)} cell{selectionSize(cellSelection) > 1 ? 's' : ''}
              </span>
            )}
            {isSelectionEmpty(cellSelection) && selectedRows.size > 0 && (
              <span className="text-primary">{selectedRows.size} row{selectedRows.size > 1 ? 's' : ''}</span>
            )}
          </div>

          {/* Center: pagination controls */}
          <div className="flex flex-1 items-center justify-center">
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleServerPageNav(0)}
                  disabled={safePage === 0}
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleServerPageNav(Math.max(0, safePage - 1))}
                  disabled={safePage === 0}
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <span className="px-1 tabular-nums text-xs">
                  Page{' '}
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    value={safePage + 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        const clamped = Math.max(1, Math.min(totalPages, val));
                        handleServerPageNav(clamped - 1);
                      }
                    }}
                    className="w-10 text-xs text-center rounded border border-border bg-transparent px-0.5 py-0 tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                  {' '}of {totalPages}
                </span>
                <button
                  onClick={() => handleServerPageNav(Math.min(totalPages - 1, safePage + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                >
                  <ChevronRightIcon className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleServerPageNav(totalPages - 1)}
                  disabled={safePage >= totalPages - 1}
                  className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Right: actions + export */}
          <div className="flex items-center gap-3">
            {database && table && (
              <Button
                variant="outline"
                size="xs"
                onClick={handleInsertRow}
                className="gap-1 text-xs"
              >
                <Plus className="h-3 w-3" />
                Insert Row
              </Button>
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => exportData('csv')}
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                CSV
              </button>
              <button
                onClick={() => exportData('json')}
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                JSON
              </button>
              <button
                onClick={() => exportData('sql')}
                className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              >
                SQL
              </button>
            </div>
            <span>{result.execution_time_ms}ms</span>
          </div>
        </div>
      )}

      {/* Row context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div
            className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 text-xs text-popover-foreground shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {/* Copy — context-aware: cells vs rows */}
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => { copySelection(); setContextMenu(null); }}
            >
              <Copy className="h-3.5 w-3.5" />
              {!isSelectionEmpty(cellSelection) ? `Copy ${selectionSize(cellSelection)} cell${selectionSize(cellSelection) > 1 ? 's' : ''}` : 'Copy selection'}
              <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+C</kbd>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                copyContextAs(contextMenu.rowIndex, 'json');
                setContextMenu(null);
              }}
            >
              <FileJson className="h-3.5 w-3.5" />
              Copy as JSON
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                copyContextAs(contextMenu.rowIndex, 'insert');
                setContextMenu(null);
              }}
            >
              <FileCode className="h-3.5 w-3.5" />
              Copy as INSERT
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                copyContextAs(contextMenu.rowIndex, 'csv');
                setContextMenu(null);
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Copy as CSV
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                copyContextAs(contextMenu.rowIndex, 'markdown');
                setContextMenu(null);
              }}
            >
              <Table2 className="h-3.5 w-3.5" />
              Copy as Markdown
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const actualRow = paginatedIndexMap[contextMenu.rowIndex];
                if (actualRow != null) {
                  const colIdx = contextMenu.colIndex;
                  const col = result.columns[colIdx];
                  const cell = columnarCellValue(columnarData, colIdx, actualRow);
                  setQuickLookCell({ cell, columnName: col.name, columnType: col.native_type });
                }
                setContextMenu(null);
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              Quick Look
              <kbd className="ml-auto text-[10px] text-muted-foreground">Space</kbd>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const all = new Set<number>();
                for (let i = 0; i < paginatedIndexMap.length; i++) all.add(i);
                setSelectedRows(all);
                setContextMenu(null);
              }}
            >
              Select All
              <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+A</kbd>
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => { exportData('csv'); setContextMenu(null); }}
            >
              Export as CSV
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => { exportData('json'); setContextMenu(null); }}
            >
              Export as JSON
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const col = result.columns[contextMenu.colIndex];
                const actualRow = paginatedIndexMap[contextMenu.rowIndex];
                const value = formatColumnarCell(columnarData, contextMenu.colIndex, actualRow);
                handleQuickFilter(col.name, value);
                setContextMenu(null);
              }}
            >
              <Filter className="h-3.5 w-3.5" />
              Quick Filter
              <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+F</kbd>
            </button>
            {(() => {
              const col = result.columns[contextMenu.colIndex];
              const fk = col ? fkMap[col.name] : null;
              const ctxActualRow = paginatedIndexMap[contextMenu.rowIndex];
              const cell = ctxActualRow != null ? columnarCellValue(columnarData, contextMenu.colIndex, ctxActualRow) : null;
              if (fk && cell && cell.type !== 'Null') {
                return (
                  <button
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-blue-600 hover:bg-accent hover:text-blue-700"
                    onClick={() => {
                      handleFkNavigate(col.name, formatCell(cell));
                      setContextMenu(null);
                    }}
                  >
                    <Key className="h-3.5 w-3.5" />
                    Go to {fk.refTable} → {formatCell(cell)}
                  </button>
                );
              }
              return null;
            })()}
            {database && table && (
              <>
                <div className="my-1 h-px bg-border" />
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => { handleInsertRow(); setContextMenu(null); }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Insert Row
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => { handlePasteRows(); setContextMenu(null); }}
                >
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  Paste Rows
                  <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+V</kbd>
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
                  onClick={() => { handleDuplicateRow(contextMenu.rowIndex); setContextMenu(null); }}
                >
                  <CopyPlus className="h-3.5 w-3.5" />
                  Duplicate Row
                  <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+D</kbd>
                </button>
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => handleDeleteRow(contextMenu.rowIndex)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Row
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* Quick Look dialog */}
      <QuickLook
        open={quickLookCell !== null}
        onClose={() => setQuickLookCell(null)}
        cell={quickLookCell?.cell ?? null}
        columnName={quickLookCell?.columnName ?? ''}
        columnType={quickLookCell?.columnType ?? ''}
      />
    </div>
  );
});
