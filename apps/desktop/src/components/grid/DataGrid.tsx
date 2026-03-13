import { useRef, useState, useCallback, useEffect, useMemo, useDeferredValue, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Key, Plus, Search, Trash2, X, Filter, Eye, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight as ChevronRightIcon, Copy, CopyPlus, ClipboardPaste, FileJson, Table2, FileCode, FileText } from 'lucide-react';
import { copyAsJson, copyAsInsert, copyAsCsv, copyAsMarkdown, copyAsTsv, copyCellAsJson, copyCellAsText, copyToClipboard } from '@/lib/copyFormats';
import type { QueryResult, CellValue, ColumnData } from '@/lib/types';
import { ipc } from '@/lib/ipc';
import { useChangeStore, type Change } from '@/stores/changeStore';
import { useShallow } from 'zustand/shallow';
import { useFilterStore } from '@/stores/filterStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useQueryStore } from '@/stores/queryStore';
import { useResultStore, formatColumnarCell } from '@/stores/resultStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { RowInsert } from '@/stores/changeStore';
import { Button } from '@/components/ui/button';
import { QuickLook } from './QuickLook';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useShortcutStore, matchesBinding } from '@/stores/shortcutStore';

interface SortRequest {
  column: string;
  direction: 'asc' | 'desc';
}

interface Props {
  result: QueryResult;
  database?: string;
  table?: string;
  onServerSort?: (sorts: SortRequest[]) => void;
}

interface EditingCell {
  rowIndex: number;
  colIndex: number;
  value: string;
  isNull?: boolean;
}

interface SortColumn {
  colIndex: number;
  direction: 'asc' | 'desc';
}

const PAGE_SIZES = [50, 100, 300, 500, 1000] as const;
const DEFAULT_COL_WIDTH = 180;
const MIN_COL_WIDTH = 80;

function cellKey(row: number, col: number): string { return `${row}:${col}`; }
function parseCellKey(key: string): { rowIndex: number; colIndex: number } {
  const [r, c] = key.split(':');
  return { rowIndex: Number(r), colIndex: Number(c) };
}

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
  data: import('@/lib/types').ColumnData[] | undefined,
  filterText: string,
  sortColumns: SortColumn[],
  rowCount: number,
): WorkerState & { useWorker: boolean } {
  const workerRef = useRef<Worker | null>(null);
  const [state, setState] = useState<WorkerState>({ filteredIndices: null, sortedIndices: null });
  const useWorker = rowCount > 1000 && !!data && data.length > 0;

  // Create worker once on mount, terminate on unmount
  useEffect(() => {
    const worker = new Worker(
      new URL('../../workers/grid.worker.ts', import.meta.url),
      { type: 'module' },
    );
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
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
    };
  }, []);

  // Clear worker state when worker is not active
  useEffect(() => {
    if (!useWorker) {
      setState({ filteredIndices: null, sortedIndices: null });
    }
  }, [useWorker]);

  // Post filter — only when worker is active
  useEffect(() => {
    if (!useWorker || !data || !workerRef.current) return;
    workerRef.current.postMessage({ type: 'filter', data, filterText });
  }, [useWorker, data, filterText]);

  // Post sort — only when worker is active
  useEffect(() => {
    if (!useWorker || !data || !workerRef.current || sortColumns.length === 0) {
      setState((prev) => ({ ...prev, sortedIndices: null }));
      return;
    }
    workerRef.current.postMessage({
      type: 'sort',
      data,
      sortColumns,
      inputIndices: state.filteredIndices,
    });
  }, [useWorker, data, sortColumns, state.filteredIndices]);

  return { ...state, useWorker };
}

export type { SortRequest };

/** Build a CellValue from columnar data at a specific position */
function columnarCellValue(data: ColumnData[], colIdx: number, rowIdx: number): CellValue {
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

/** Build Row objects on-demand from columnar data for a specific set of actual row indices */
function buildRowsOnDemand(
  data: ColumnData[],
  columns: { name: string }[],
  rowIndices: number[],
): { cells: CellValue[] }[] {
  return rowIndices.map((rowIdx) => ({
    cells: columns.map((_, colIdx) => columnarCellValue(data, colIdx, rowIdx)),
  }));
}

export const DataGrid = memo(function DataGrid({ result, database, table, onServerSort }: Props) {
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
  const gridRef = useRef<HTMLDivElement>(null);

  // Cell selection state (multi-cell: "rowIndex:colIndex" keys)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [lastSelectedCellKey, setLastSelectedCellKey] = useState<{ rowIndex: number; colIndex: number } | null>(null);

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

  // Drag selection state (cells)
  const isCellDraggingRef = useRef(false);
  const [cellDragStart, setCellDragStart] = useState<{ rowIndex: number; colIndex: number } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number; colIndex: number } | null>(null);

  // Preferences
  const alternatingRowColors = usePreferencesStore((s) => s.alternatingRowColors);
  const defaultCopyFormat = usePreferencesStore((s) => s.defaultCopyFormat);

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

  // Worker-based filter/sort for large datasets
  const activeTabId = useQueryStore((s) => s.activeTabId);
  const tabResult = useResultStore((s) => activeTabId ? s.results[activeTabId] : undefined);
  // Columnar data — primary data source for rendering
  const columnarData: ColumnData[] = tabResult?.data ?? [];
  const columnarRowCount = tabResult?.rowCount ?? result.rows.length;
  const { filteredIndices: workerFilteredIndices, sortedIndices: workerSortedIndices, useWorker } = useGridWorker(
    tabResult?.data,
    filterText,
    sortColumns,
    columnarRowCount,
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
    const refDb = fk.refDb ?? database ?? '';
    const pageSize = usePreferencesStore.getState().defaultPageSize;
    const limitClause = pageSize > 0 ? ` LIMIT ${pageSize}` : '';
    const sql = `SELECT * FROM \`${fk.refTable}\` WHERE \`${fk.refColumn}\` = '${cellValue.replace(/'/g, "''")}'${limitClause}`;
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

  const getCellPendingEdit = useCallback((rowIndex: number, colName: string) => {
    return pendingChanges.find(
      (c) => c.type === 'edit' && c.rowIndex === rowIndex && c.column === colName
    );
  }, [pendingChanges]);

  const isRowDeleted = useCallback((rowIndex: number) => {
    return pendingChanges.some((c) => c.type === 'delete' && c.rowIndex === rowIndex);
  }, [pendingChanges]);

  const handleInsertRow = useCallback(() => {
    if (!database || !table) return;
    const values: Record<string, any> = {};
    result.columns.forEach((col) => {
      values[col.name] = null;
    });
    addChange({ type: 'insert', table, database, values });
  }, [database, table, result.columns, addChange]);

  const insertedRows = pendingChanges.filter((c): c is RowInsert => c.type === 'insert');

  // ─── Data pipeline: filter → sort → paginate ──────────────────────────────

  // Filter pipeline — works directly on columnar data (no row conversion)
  // When worker is active, return cheap identity array; worker computes real filter
  const filteredIndexMap = useMemo(() => {
    const rowCount = columnarRowCount;
    if (useWorker || !filterText) {
      return Array.from({ length: rowCount }, (_, i) => i);
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
  }, [filterText, columnarData, columnarRowCount, useWorker]);

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

  // Paginate — now purely index-based (no row objects)
  const totalSortedRows = finalSortedIndexMap.length;
  const totalPages = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(totalSortedRows / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);

  const paginatedIndexMap = useMemo(() => {
    if (pageSize === Infinity) return finalSortedIndexMap;
    const start = safePage * pageSize;
    const end = start + pageSize;
    return finalSortedIndexMap.slice(start, end);
  }, [finalSortedIndexMap, safePage, pageSize]);

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

  // Focus input on edit
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

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
            const rowNumWidth = 50;
            let total = rowNumWidth;
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
    const rowNumWidth = 50; // matches w-[50px]
    return rowNumWidth + visibleColumns.reduce((sum, _, visIdx) => {
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

  // Row gutter click → row selection only (left click)
  const handleRowGutterMouseDown = useCallback(
    (e: React.MouseEvent, rowIndex: number) => {
      if (editingCell) return;
      if (e.button === 2) return;
      e.stopPropagation();
      setSelectedCells(new Set());
      setLastSelectedCellKey(null);
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
    },
    [lastSelectedRow, editingCell],
  );

  const handleRowMouseEnter = useCallback(
    (rowIndex: number) => {
      if (!isDraggingRef.current || dragStartRow === null) return;
      const start = Math.min(dragStartRow, rowIndex);
      const end = Math.max(dragStartRow, rowIndex);
      const next = new Set<number>();
      for (let i = start; i <= end; i++) next.add(i);
      setSelectedRows(next);
      setSelectedCells(new Set());
    },
    [dragStartRow],
  );

  // Cell click → cell selection + start drag (left click only)
  const handleCellMouseDown = useCallback(
    (e: React.MouseEvent, rowIndex: number, colIndex: number) => {
      if (editingCell) return;
      if (e.button === 2) return; // right-click handled by onContextMenu
      e.stopPropagation();
      setSelectedRows(new Set());
      if (e.shiftKey && lastSelectedCellKey) {
        // Range select from last cell to this cell
        const minRow = Math.min(lastSelectedCellKey.rowIndex, rowIndex);
        const maxRow = Math.max(lastSelectedCellKey.rowIndex, rowIndex);
        const minCol = Math.min(lastSelectedCellKey.colIndex, colIndex);
        const maxCol = Math.max(lastSelectedCellKey.colIndex, colIndex);
        const next = new Set<string>();
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            next.add(cellKey(r, c));
          }
        }
        setSelectedCells(next);
      } else if (e.ctrlKey || e.metaKey) {
        setSelectedCells((prev) => {
          const next = new Set(prev);
          const k = cellKey(rowIndex, colIndex);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          return next;
        });
        setLastSelectedCellKey({ rowIndex, colIndex });
      } else {
        isCellDraggingRef.current = true;
        setCellDragStart({ rowIndex, colIndex });
        setSelectedCells(new Set([cellKey(rowIndex, colIndex)]));
        setLastSelectedCellKey({ rowIndex, colIndex });
      }
      setFocusedColIndex(colIndex);
      setFocusedCell({ row: rowIndex, col: colIndex });
    },
    [editingCell, lastSelectedCellKey],
  );

  // Cell drag → rectangular selection
  const handleCellMouseEnter = useCallback(
    (rowIndex: number, colIndex: number) => {
      if (!isCellDraggingRef.current || !cellDragStart) return;
      const minRow = Math.min(cellDragStart.rowIndex, rowIndex);
      const maxRow = Math.max(cellDragStart.rowIndex, rowIndex);
      const minCol = Math.min(cellDragStart.colIndex, colIndex);
      const maxCol = Math.max(cellDragStart.colIndex, colIndex);
      const next = new Set<string>();
      for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
          next.add(cellKey(r, c));
        }
      }
      setSelectedCells(next);
      setLastSelectedCellKey({ rowIndex, colIndex });
    },
    [cellDragStart],
  );

  const handleCellDoubleClick = useCallback(
    (rowIndex: number, colIndex: number) => {
      const actualRowIndex = paginatedIndexMap[rowIndex];
      const cell = columnarCellValue(columnarData, colIndex, actualRowIndex);
      const isNull = cell.type === 'Null';
      setEditingCell({ rowIndex, colIndex, value: isNull ? '' : formatCell(cell), isNull });
    },
    [paginatedIndexMap, columnarData],
  );

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
        if (col.is_primary_key) primaryKeys[col.name] = formatColumnarCell(columnarData, i, actualRowIndex);
      });
      if (Object.keys(primaryKeys).length > 0) {
        addChange({
          type: 'edit', table, database, rowIndex: actualRowIndex, primaryKeys,
          column: column.name, oldValue, newValue,
        });
      }
    }
    setEditingCell(null);
  }, [editingCell, result.columns, columnarData, database, table, addChange, paginatedIndexMap]);

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
        if (col.is_primary_key) primaryKeys[col.name] = formatColumnarCell(columnarData, i, actualRowIndex);
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
  }, [editingCell, paginatedIndexMap, columnarData, result.columns, database, table, addChange, visibleColumns, visibleColIndexMap]);

  const handleDeleteRow = useCallback((paginatedIdx: number) => {
    if (!database || !table) return;
    const actualRowIndex = paginatedIndexMap[paginatedIdx];
    const primaryKeys: Record<string, string | number | boolean | null> = {};
    const originalRow: Record<string, string | number | boolean | null> = {};
    result.columns.forEach((col, i) => {
      const formatted = formatColumnarCell(columnarData, i, actualRowIndex);
      if (col.is_primary_key) primaryKeys[col.name] = formatted;
      originalRow[col.name] = formatted;
    });
    if (Object.keys(primaryKeys).length === 0) return;
    addChange({ type: 'delete', table, database, rowIndex: actualRowIndex, primaryKeys, originalRow });
    setContextMenu(null);
  }, [database, table, result.columns, columnarData, addChange, paginatedIndexMap]);

  const formatRowsForCopy = useCallback((columns: typeof result.columns, rows: { cells: CellValue[] }[]) => {
    switch (defaultCopyFormat) {
      case 'json': return copyAsJson(columns, rows);
      case 'csv': return copyAsCsv(columns, rows);
      case 'tsv': return copyAsTsv(columns, rows);
      case 'markdown': return copyAsMarkdown(columns, rows);
      case 'insert': return copyAsInsert(columns, rows, table || 'table');
      default: return copyAsJson(columns, rows);
    }
  }, [defaultCopyFormat, table]);

  const copySelection = useCallback(() => {
    // Cell selection
    if (selectedCells.size > 0) {
      const parsed = [...selectedCells].map(parseCellKey);
      if (parsed.length === 1) {
        // Single cell
        const { rowIndex, colIndex } = parsed[0];
        const actualRowIndex = paginatedIndexMap[rowIndex];
        if (actualRowIndex == null) return;
        const col = result.columns[colIndex];
        const cell = columnarCellValue(columnarData, colIndex, actualRowIndex);
        if (defaultCopyFormat === 'json') {
          copyToClipboard(copyCellAsJson(col.name, cell));
        } else {
          copyToClipboard(copyCellAsText(cell));
        }
      } else {
        // Multi-cell: gather unique rows/cols, build partial rows for copy
        const colIndices = [...new Set(parsed.map((p) => p.colIndex))].sort((a, b) => a - b);
        const rowIndices = [...new Set(parsed.map((p) => p.rowIndex))].sort((a, b) => a - b);
        const cols = colIndices.map((i) => result.columns[i]);
        const rows = rowIndices.map((ri) => {
          const actualRow = paginatedIndexMap[ri];
          return { cells: colIndices.map((ci) => columnarCellValue(columnarData, ci, actualRow)) };
        });
        copyToClipboard(formatRowsForCopy(cols, rows as any));
      }
      return;
    }
    // Row selection
    if (selectedRows.size === 0) return;
    const sortedIndices = [...selectedRows].sort((a, b) => a - b);
    const actualRows = sortedIndices.map((idx) => paginatedIndexMap[idx]);
    const rows = buildRowsOnDemand(columnarData, result.columns, actualRows);
    copyToClipboard(formatRowsForCopy(result.columns, rows));
  }, [selectedCells, selectedRows, result.columns, columnarData, paginatedIndexMap, defaultCopyFormat, formatRowsForCopy]);

  const getSelectedOrContextRows = useCallback((contextRowIndex: number) => {
    const indices = selectedRows.size > 0
      ? [...selectedRows].sort((a, b) => a - b)
      : [contextRowIndex];
    const actualRows = indices.map((idx) => paginatedIndexMap[idx]);
    return buildRowsOnDemand(columnarData, result.columns, actualRows);
  }, [selectedRows, paginatedIndexMap, columnarData, result.columns]);

  // Build columns + rows from cell selection (for copy actions)
  const getContextColumnsFromCells = useCallback(() => {
    const parsed = [...selectedCells].map(parseCellKey);
    const colIndices = [...new Set(parsed.map((p) => p.colIndex))].sort((a, b) => a - b);
    return colIndices.map((i) => result.columns[i]);
  }, [selectedCells, result.columns]);

  const getContextRowsFromCells = useCallback(() => {
    const parsed = [...selectedCells].map(parseCellKey);
    const colIndices = [...new Set(parsed.map((p) => p.colIndex))].sort((a, b) => a - b);
    const rowIndices = [...new Set(parsed.map((p) => p.rowIndex))].sort((a, b) => a - b);
    return rowIndices.map((ri) => {
      const actualRow = paginatedIndexMap[ri];
      return { cells: colIndices.map((ci) => columnarCellValue(columnarData, ci, actualRow)) };
    }) as { cells: CellValue[] }[];
  }, [selectedCells, paginatedIndexMap, columnarData]);

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
        setSelectedCells(new Set());
        setLastSelectedCellKey(null);
        return true;
      default:
        return false;
    }

    setFocusedCell({ row, col });
    // Sync cell selection so copy and other operations work
    if (!e.shiftKey || e.key === 'Tab' || e.key === 'Home' || e.key === 'End') {
      setSelectedCells(new Set([cellKey(row, col)]));
    } else {
      setSelectedCells((prev) => {
        const next = new Set(prev);
        next.add(cellKey(row, col));
        return next;
      });
    }
    setLastSelectedCellKey({ rowIndex: row, colIndex: col });
    setFocusedColIndex(col);
    setSelectedRows(new Set());
    return true;
  }, [focusedCell, editingCell, paginatedIndexMap.length, visibleColIndexMap]);

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
      setSelectedCells(new Set());
      setLastSelectedCellKey(null);
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
      else if (focusedCell) { setFocusedCell(null); setSelectedCells(new Set()); setLastSelectedCellKey(null); }
      else if (selectedCells.size > 0) { setSelectedCells(new Set()); setLastSelectedCellKey(null); }
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
      if (lastSelectedCellKey && !editingCell) {
        e.preventDefault();
        const nextCol = e.key === 'ArrowRight'
          ? Math.min(lastSelectedCellKey.colIndex + 1, result.columns.length - 1)
          : Math.max(lastSelectedCellKey.colIndex - 1, 0);
        const next = { rowIndex: lastSelectedCellKey.rowIndex, colIndex: nextCol };
        if (e.shiftKey) {
          setSelectedCells((prev) => { const s = new Set(prev); s.add(cellKey(next.rowIndex, next.colIndex)); return s; });
        } else {
          setSelectedCells(new Set([cellKey(next.rowIndex, next.colIndex)]));
        }
        setLastSelectedCellKey(next);
        setFocusedColIndex(nextCol);
        return;
      }
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (lastSelectedCellKey && selectedCells.size > 0) {
        const nextRow = e.key === 'ArrowDown'
          ? Math.min(lastSelectedCellKey.rowIndex + 1, paginatedIndexMap.length - 1)
          : Math.max(lastSelectedCellKey.rowIndex - 1, 0);
        const next = { rowIndex: nextRow, colIndex: lastSelectedCellKey.colIndex };
        if (e.shiftKey) {
          setSelectedCells((prev) => { const s = new Set(prev); s.add(cellKey(next.rowIndex, next.colIndex)); return s; });
        } else {
          setSelectedCells(new Set([cellKey(next.rowIndex, next.colIndex)]));
          setSelectedRows(new Set());
        }
        setLastSelectedCellKey(next);
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
  }, [copySelection, paginatedIndexMap, columnarData, editingCell, cancelEdit, lastSelectedRow, contextMenu, focusedColIndex, result.columns, selectedRows, selectedCells, lastSelectedCellKey, database, table, handleDuplicateRow, handlePasteRows, focusedCell, handleGridKeyDown]);

  // ─── Export ────────────────────────────────────────────────────────────────

  const exportData = useCallback(async (format: 'csv' | 'json' | 'sql') => {
    const selectedIndices = selectedRows.size > 0
      ? [...selectedRows].sort((a, b) => a - b).map((i) => paginatedIndexMap[i])
      : paginatedIndexMap;
    const cols = result.columns;
    let content: string;
    let filename: string;

    if (format === 'csv') {
      const header = cols.map((c) => `"${c.name}"`).join(',');
      const rows = selectedIndices.map((actualRow) =>
        cols.map((_, colIdx) => {
          const val = formatColumnarCell(columnarData, colIdx, actualRow);
          return `"${val.replace(/"/g, '""')}"`;
        }).join(',')
      );
      content = [header, ...rows].join('\n');
      filename = `${table ?? 'export'}.csv`;
    } else if (format === 'json') {
      const data = selectedIndices.map((actualRow) => {
        const obj: Record<string, string> = {};
        cols.forEach((col, colIdx) => {
          obj[col.name] = formatColumnarCell(columnarData, colIdx, actualRow);
        });
        return obj;
      });
      content = JSON.stringify(data, null, 2);
      filename = `${table ?? 'export'}.json`;
    } else {
      const tableName = table ?? 'table_name';
      const colNames = cols.map((c) => `\`${c.name}\``).join(', ');
      const rows = selectedIndices.map((actualRow) => {
        const values = cols.map((_, colIdx) => {
          const cell = columnarCellValue(columnarData, colIdx, actualRow);
          if (cell.type === 'Null') return 'NULL';
          if (cell.type === 'Integer' || cell.type === 'Float') return String(cell.value);
          if (cell.type === 'Boolean') return cell.value ? '1' : '0';
          return `'${formatCell(cell).replace(/'/g, "''")}'`;
        }).join(', ');
        return `INSERT INTO \`${tableName}\` (${colNames}) VALUES (${values});`;
      });
      content = rows.join('\n');
      filename = `${table ?? 'export'}.sql`;
    }

    await ipc.saveSqlFile(content, filename);
  }, [selectedRows, result.columns, columnarData, paginatedIndexMap, table]);

  // ─── Pagination helpers ────────────────────────────────────────────────────

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(0);
    // Persist to preferences store (0 = All)
    usePreferencesStore.getState().setPreference('defaultPageSize', size === Infinity ? 0 : size);
  }, []);

  const pageStart = pageSize === Infinity ? 0 : safePage * pageSize;
  const pageEnd = pageSize === Infinity ? totalSortedRows : Math.min(pageStart + pageSize, totalSortedRows);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full select-none overflow-auto bg-background outline-none focus:outline-none"
      style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
      onScroll={() => { if (contextMenu) setContextMenu(null); }}
      onClick={(e) => {
        if (e.target === parentRef.current) { setSelectedRows(new Set()); setSelectedCells(new Set()); setLastSelectedCellKey(null); }
      }}
    >
      {/* Column headers */}
      <div className="sticky top-0 z-10 flex border-b-2 border-border bg-muted" style={{ minWidth: totalWidthStyle }}>
        <div className="flex w-[50px] shrink-0 items-center justify-center border-r border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          #
        </div>
        {visibleColumns.map((col, visIdx) => {
          const colIdx = visibleColIndexMap[visIdx];
          const sortDir = getSortDirection(colIdx);

          return (
            <div
              key={col.name}
              className="relative flex shrink-0 items-center gap-1 border-r border-border px-2 py-1.5 cursor-pointer hover:bg-accent/30"
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
                  <Badge variant="secondary" className="h-3.5 rounded px-1 py-0 text-[9px] font-normal">
                    {formatDataType(col.data_type)}
                  </Badge>
                  {col.nullable && (
                    <span className="text-[9px] text-muted-foreground">null</span>
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
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, minWidth: totalWidthStyle }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const actualRowIndex = paginatedIndexMap[virtualRow.index];
          const displayIndex = pageStart + virtualRow.index;
          const isOdd = virtualRow.index % 2 === 1;
          const isSelected = selectedRows.has(virtualRow.index);
          const rowDeleted = isRowDeleted(actualRowIndex);

          return (
            <div
              key={virtualRow.index}
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
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                minWidth: totalWidthStyle,
              }}
              onMouseEnter={() => handleRowMouseEnter(virtualRow.index)}
              onContextMenu={(e) => {
                e.preventDefault();
                // Row-level context (gutter area) — only if no cell selection
                if (selectedCells.size === 0 && !selectedRows.has(virtualRow.index)) {
                  setSelectedRows(new Set([virtualRow.index]));
                  setLastSelectedRow(virtualRow.index);
                }
                setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: virtualRow.index, colIndex: 0 });
              }}
            >
              {/* Row number (click to select row) */}
              <div
                className={cn(
                  'flex w-[50px] shrink-0 items-center justify-center border-r border-border/30 text-[10px] cursor-pointer',
                  isSelected ? 'font-semibold text-primary' : 'text-muted-foreground',
                  rowDeleted && 'line-through',
                )}
                onMouseDown={(e) => handleRowGutterMouseDown(e, virtualRow.index)}
              >
                {displayIndex + 1}
              </div>

              {/* Cells */}
              {visibleColumns.map((col, visIdx) => {
                const colIdx = visibleColIndexMap[visIdx];
                const cell = columnarCellValue(columnarData, colIdx, actualRowIndex);
                const isEditing =
                  editingCell?.rowIndex === virtualRow.index &&
                  editingCell?.colIndex === colIdx;
                const pendingEdit = getCellPendingEdit(actualRowIndex, col.name);

                const isCellSelected = selectedCells.has(cellKey(virtualRow.index, colIdx));
                const isFocused = focusedCell?.row === virtualRow.index && focusedCell?.col === colIdx;

                return (
                  <div
                    key={colIdx}
                    className={cn(
                      'flex shrink-0 items-center border-r border-border/30',
                      isEditing && 'ring-2 ring-inset ring-primary',
                      !isEditing && isFocused && 'ring-2 ring-primary ring-inset',
                      !isEditing && !isFocused && isCellSelected && 'ring-2 ring-inset ring-primary/60 bg-primary/10',
                      pendingEdit && !isEditing && 'bg-yellow-500/15',
                    )}
                    style={{ width: getColWidthStyle(colIdx) }}
                    onMouseDown={(e) => handleCellMouseDown(e, virtualRow.index, colIdx)}
                    onMouseEnter={() => handleCellMouseEnter(virtualRow.index, colIdx)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const k = cellKey(virtualRow.index, colIdx);
                      if (selectedCells.size > 0) {
                        // If right-clicking outside current cell selection, select just this cell
                        if (!selectedCells.has(k)) {
                          setSelectedCells(new Set([k]));
                          setLastSelectedCellKey({ rowIndex: virtualRow.index, colIndex: colIdx });
                          setSelectedRows(new Set());
                        }
                        // Otherwise keep current cell selection
                      } else {
                        // No cell selection — fallback to row selection
                        if (!selectedRows.has(virtualRow.index)) {
                          setSelectedRows(new Set([virtualRow.index]));
                          setLastSelectedRow(virtualRow.index);
                        }
                      }
                      setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: virtualRow.index, colIndex: colIdx });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!rowDeleted) handleCellDoubleClick(virtualRow.index, colIdx);
                    }}
                  >
                    {isEditing ? (
                      <div className="flex h-full w-full items-center bg-background">
                        <input
                          ref={editInputRef}
                          className={cn(
                            "h-full min-w-0 flex-1 border-none bg-transparent px-2 py-1 outline-none",
                            editingCell.isNull ? 'italic text-muted-foreground' : 'text-foreground'
                          )}
                          style={{ fontFamily: 'inherit', fontSize: 'inherit' }}
                          value={editingCell.isNull ? '' : editingCell.value}
                          placeholder={editingCell.isNull ? 'NULL' : ''}
                          onChange={(e) =>
                            setEditingCell((prev) =>
                              prev ? { ...prev, value: e.target.value, isNull: false } : null,
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Tab') { e.preventDefault(); commitAndMove(e.shiftKey ? 'left' : 'right'); return; }
                            if (e.key === 'Enter') { commitAndMove('down'); return; }
                            if (e.key === 'Escape') cancelEdit();
                            e.stopPropagation();
                          }}
                          onBlur={commitEdit}
                        />
                        {col.nullable && (
                          <button
                            className={cn(
                              'shrink-0 px-1 text-[9px] font-mono rounded mr-0.5',
                              editingCell.isNull
                                ? 'text-primary font-bold bg-primary/10'
                                : 'text-muted-foreground/40 hover:text-muted-foreground'
                            )}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setEditingCell((prev) =>
                                prev ? { ...prev, isNull: !prev.isNull, value: '' } : null,
                              );
                            }}
                            title="Toggle NULL (Ctrl+Shift+N)"
                          >
                            NULL
                          </button>
                        )}
                      </div>
                    ) : (
                      <span
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
                                    : fkMap[col.name]
                                      ? 'text-blue-600 dark:text-blue-400 underline decoration-dotted cursor-pointer hover:text-blue-700'
                                      : 'text-foreground',
                        )}
                        onClick={(e) => {
                          if (fkMap[col.name]) {
                            e.stopPropagation();
                            handleFkNavigate(col.name, formatCell(cell));
                          }
                        }}
                      >
                        {pendingEdit && pendingEdit.type === 'edit' ? String(pendingEdit.newValue) : formatCell(cell)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
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
          {visibleColumns.map((col, visIdx) => {
            const colIdx = visibleColIndexMap[visIdx];
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
        </div>
      ))}

      {/* Footer with pagination */}
      {columnarRowCount > 0 && (
        <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-muted px-3 py-1 text-[11px] text-muted-foreground" style={{ minWidth: totalWidthStyle }}>
          {/* Row info */}
          <span>
            {totalSortedRows > 0
              ? `${pageStart + 1}–${pageEnd} of ${totalSortedRows}`
              : '0 rows'}
          </span>
          {selectedCells.size > 0 && (
            <span className="text-primary">
              {selectedCells.size} cell{selectedCells.size > 1 ? 's' : ''}
            </span>
          )}
          {selectedCells.size === 0 && selectedRows.size > 0 && (
            <span className="text-primary">{selectedRows.size} row{selectedRows.size > 1 ? 's' : ''}</span>
          )}

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className="px-1 tabular-nums">
                {safePage + 1}/{totalPages}
              </span>
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                className="rounded p-0.5 hover:bg-accent disabled:opacity-30"
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Page size selector */}
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

          <div className="ml-auto flex items-center gap-3">
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
              {selectedCells.size > 0 ? `Copy ${selectedCells.size} cell${selectedCells.size > 1 ? 's' : ''}` : 'Copy selection'}
              <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+C</kbd>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const rows = selectedCells.size > 0 ? getContextRowsFromCells() : getSelectedOrContextRows(contextMenu.rowIndex);
                copyToClipboard(copyAsJson(selectedCells.size > 0 ? getContextColumnsFromCells() : result.columns, rows));
                setContextMenu(null);
              }}
            >
              <FileJson className="h-3.5 w-3.5" />
              Copy as JSON
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const cols = selectedCells.size > 0 ? getContextColumnsFromCells() : result.columns;
                const rows = selectedCells.size > 0 ? getContextRowsFromCells() : getSelectedOrContextRows(contextMenu.rowIndex);
                copyToClipboard(copyAsInsert(cols, rows, table || 'table'));
                setContextMenu(null);
              }}
            >
              <FileCode className="h-3.5 w-3.5" />
              Copy as INSERT
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const cols = selectedCells.size > 0 ? getContextColumnsFromCells() : result.columns;
                const rows = selectedCells.size > 0 ? getContextRowsFromCells() : getSelectedOrContextRows(contextMenu.rowIndex);
                copyToClipboard(copyAsCsv(cols, rows));
                setContextMenu(null);
              }}
            >
              <FileText className="h-3.5 w-3.5" />
              Copy as CSV
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const cols = selectedCells.size > 0 ? getContextColumnsFromCells() : result.columns;
                const rows = selectedCells.size > 0 ? getContextRowsFromCells() : getSelectedOrContextRows(contextMenu.rowIndex);
                copyToClipboard(copyAsMarkdown(cols, rows));
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

function formatCell(cell: CellValue): string {
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
