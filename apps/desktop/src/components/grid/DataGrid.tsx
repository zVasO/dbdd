import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Key, Plus, Search, Trash2, X, Filter, Eye, ChevronUp, ChevronDown, ChevronsUpDown, ChevronLeft, ChevronRight as ChevronRightIcon, Copy, CopyPlus, ClipboardPaste, FileJson, Table2, FileCode, FileText } from 'lucide-react';
import { copyAsJson, copyAsInsert, copyAsCsv, copyAsMarkdown, copyAsTsv, copyCellAsJson, copyCellAsText, copyToClipboard } from '@/lib/copyFormats';
import type { QueryResult, CellValue } from '@/lib/types';
import { ipc } from '@/lib/ipc';
import { useChangeStore } from '@/stores/changeStore';
import { useFilterStore } from '@/stores/filterStore';
import { useSchemaStore } from '@/stores/schemaStore';
import { useQueryStore } from '@/stores/queryStore';
import { useConnectionStore } from '@/stores/connectionStore';
import type { RowInsert } from '@/stores/changeStore';
import { Button } from '@/components/ui/button';
import { QuickLook } from './QuickLook';
import { usePreferencesStore } from '@/stores/preferencesStore';
import { useShortcutStore, matchesBinding } from '@/stores/shortcutStore';

interface Props {
  result: QueryResult;
  database?: string;
  table?: string;
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

const PAGE_SIZES = [100, 300, 500, 1000] as const;
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
  try {
    const v = localStorage.getItem('dataforge:pageSize');
    if (v === 'all') return Infinity;
    const n = Number(v);
    if (n > 0) return n;
    return usePreferencesStore.getState().defaultPageSize;
  } catch {
    return 300;
  }
}

export function DataGrid({ result, database, table }: Props) {
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

  // Cell selection state (multi-cell: "rowIndex:colIndex" keys)
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [lastSelectedCellKey, setLastSelectedCellKey] = useState<{ rowIndex: number; colIndex: number } | null>(null);

  // Filter state
  const [filterText, setFilterText] = useState('');

  // Sorting state
  const [sortColumns, setSortColumns] = useState<SortColumn[]>([]);

  // Pagination state
  const [pageSize, setPageSize] = useState<number>(getStoredPageSize);
  const [currentPage, setCurrentPage] = useState(0);

  // Column resize state
  const [columnWidths, setColumnWidths] = useState<Record<number, number>>({});
  const resizingRef = useRef<{ colIndex: number; startX: number; startWidth: number } | null>(null);

  // Drag selection state (rows)
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartRow, setDragStartRow] = useState<number | null>(null);

  // Drag selection state (cells)
  const [isCellDragging, setIsCellDragging] = useState(false);
  const [cellDragStart, setCellDragStart] = useState<{ rowIndex: number; colIndex: number } | null>(null);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number; colIndex: number } | null>(null);

  // Preferences
  const alternatingRowColors = usePreferencesStore((s) => s.alternatingRowColors);
  const defaultCopyFormat = usePreferencesStore((s) => s.defaultCopyFormat);

  // Change tracking
  const addChange = useChangeStore((s) => s.addChange);
  const pending = useChangeStore((s) => s.pending);
  const pendingChanges = useMemo(
    () => database && table
      ? pending.filter((c) => c.database === database && c.table === table)
      : [],
    [pending, database, table]
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
    const sql = `SELECT * FROM \`${fk.refTable}\` WHERE \`${fk.refColumn}\` = '${cellValue.replace(/'/g, "''")}' LIMIT 500`;
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

  const { filteredRows, filteredIndexMap } = useMemo(() => {
    if (!filterText) {
      return {
        filteredRows: result.rows,
        filteredIndexMap: result.rows.map((_, i) => i),
      };
    }
    const rows: typeof result.rows = [];
    const indexMap: number[] = [];
    result.rows.forEach((row, i) => {
      if (row.cells.some((cell) => formatCell(cell).toLowerCase().includes(filterText.toLowerCase()))) {
        rows.push(row);
        indexMap.push(i);
      }
    });
    return { filteredRows: rows, filteredIndexMap: indexMap };
  }, [filterText, result.rows]);

  // Sort
  const { sortedRows, sortedIndexMap } = useMemo(() => {
    if (sortColumns.length === 0) {
      return { sortedRows: filteredRows, sortedIndexMap: filteredIndexMap };
    }

    const indices = filteredRows.map((_, i) => i);
    indices.sort((a, b) => {
      for (const { colIndex, direction } of sortColumns) {
        const cellA = filteredRows[a].cells[colIndex];
        const cellB = filteredRows[b].cells[colIndex];
        const valA = formatCell(cellA);
        const valB = formatCell(cellB);

        // Nulls last
        if (cellA.type === 'Null' && cellB.type !== 'Null') return 1;
        if (cellA.type !== 'Null' && cellB.type === 'Null') return -1;
        if (cellA.type === 'Null' && cellB.type === 'Null') continue;

        let cmp = 0;
        if ((cellA.type === 'Integer' || cellA.type === 'Float') && (cellB.type === 'Integer' || cellB.type === 'Float')) {
          cmp = (cellA.value as number) - (cellB.value as number);
        } else {
          cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        }

        if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
      }
      return 0;
    });

    return {
      sortedRows: indices.map((i) => filteredRows[i]),
      sortedIndexMap: indices.map((i) => filteredIndexMap[i]),
    };
  }, [filteredRows, filteredIndexMap, sortColumns]);

  // Paginate
  const totalSortedRows = sortedRows.length;
  const totalPages = pageSize === Infinity ? 1 : Math.max(1, Math.ceil(totalSortedRows / pageSize));
  const safePage = Math.min(currentPage, totalPages - 1);

  const { paginatedRows, paginatedIndexMap } = useMemo(() => {
    if (pageSize === Infinity) {
      return { paginatedRows: sortedRows, paginatedIndexMap: sortedIndexMap };
    }
    const start = safePage * pageSize;
    const end = start + pageSize;
    return {
      paginatedRows: sortedRows.slice(start, end),
      paginatedIndexMap: sortedIndexMap.slice(start, end),
    };
  }, [sortedRows, sortedIndexMap, safePage, pageSize]);

  const handleDuplicateRow = useCallback((paginatedIdx: number) => {
    if (!database || !table) return;
    const actualRowIndex = paginatedIndexMap[paginatedIdx];
    const row = result.rows[actualRowIndex];
    const values: Record<string, string | number | boolean | null> = {};
    result.columns.forEach((col, i) => {
      const cell = row.cells[i];
      if (col.is_primary_key) {
        values[col.name] = null;
      } else if (cell.type === 'Null') {
        values[col.name] = null;
      } else if (cell.type === 'Integer' || cell.type === 'Float') {
        values[col.name] = cell.value as number;
      } else if (cell.type === 'Boolean') {
        values[col.name] = cell.value as boolean;
      } else {
        values[col.name] = formatCell(cell);
      }
    });
    addChange({ type: 'insert', table, database, values });
  }, [database, table, result, addChange, paginatedIndexMap]);

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
    count: paginatedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  // Focus input on edit
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Global mouseup for drag selection + column resize
  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) setIsDragging(false);
      if (isCellDragging) setIsCellDragging(false);
      if (resizingRef.current) {
        resizingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (resizingRef.current) {
        const delta = e.clientX - resizingRef.current.startX;
        const newWidth = Math.max(MIN_COL_WIDTH, resizingRef.current.startWidth + delta);
        setColumnWidths((prev) => ({ ...prev, [resizingRef.current!.colIndex]: newWidth }));
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDragging, isCellDragging]);

  // ─── Column resize ─────────────────────────────────────────────────────────

  const handleResizeStart = useCallback((e: React.MouseEvent, colIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    const currentWidth = columnWidths[colIndex] ?? DEFAULT_COL_WIDTH;
    resizingRef.current = { colIndex, startX: e.clientX, startWidth: currentWidth };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [columnWidths]);

  const getColWidth = useCallback((colIndex: number) => {
    return columnWidths[colIndex] ?? DEFAULT_COL_WIDTH;
  }, [columnWidths]);

  // Total content width for horizontal scroll: row-number col + all visible column widths
  const totalContentWidth = useMemo(() => {
    const rowNumWidth = 50; // matches w-[50px]
    return rowNumWidth + visibleColumns.reduce((sum, _, visIdx) => {
      const colIdx = visibleColIndexMap[visIdx];
      return sum + (columnWidths[colIdx] ?? DEFAULT_COL_WIDTH);
    }, 0);
  }, [visibleColumns, visibleColIndexMap, columnWidths]);

  // ─── Column sorting ────────────────────────────────────────────────────────

  const handleHeaderClick = useCallback((colIndex: number, shiftKey: boolean) => {
    setSortColumns((prev) => {
      const existingIdx = prev.findIndex((s) => s.colIndex === colIndex);
      if (existingIdx !== -1) {
        const existing = prev[existingIdx];
        if (existing.direction === 'asc') {
          // asc → desc
          const next = [...prev];
          next[existingIdx] = { ...existing, direction: 'desc' };
          return next;
        } else {
          // desc → remove
          return prev.filter((_, i) => i !== existingIdx);
        }
      }
      // New sort
      if (shiftKey) {
        return [...prev, { colIndex, direction: 'asc' }];
      }
      return [{ colIndex, direction: 'asc' }];
    });
  }, []);

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
        setIsDragging(true);
        setDragStartRow(rowIndex);
        setSelectedRows(new Set([rowIndex]));
      }
      setLastSelectedRow(rowIndex);
    },
    [lastSelectedRow, editingCell],
  );

  const handleRowMouseEnter = useCallback(
    (rowIndex: number) => {
      if (!isDragging || dragStartRow === null) return;
      const start = Math.min(dragStartRow, rowIndex);
      const end = Math.max(dragStartRow, rowIndex);
      const next = new Set<number>();
      for (let i = start; i <= end; i++) next.add(i);
      setSelectedRows(next);
      setSelectedCells(new Set());
    },
    [isDragging, dragStartRow],
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
        setIsCellDragging(true);
        setCellDragStart({ rowIndex, colIndex });
        setSelectedCells(new Set([cellKey(rowIndex, colIndex)]));
        setLastSelectedCellKey({ rowIndex, colIndex });
      }
      setFocusedColIndex(colIndex);
    },
    [editingCell, lastSelectedCellKey],
  );

  // Cell drag → rectangular selection
  const handleCellMouseEnter = useCallback(
    (rowIndex: number, colIndex: number) => {
      if (!isCellDragging || !cellDragStart) return;
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
    [isCellDragging, cellDragStart],
  );

  const handleCellDoubleClick = useCallback(
    (rowIndex: number, colIndex: number) => {
      const cell = paginatedRows[rowIndex].cells[colIndex];
      const isNull = cell.type === 'Null';
      setEditingCell({ rowIndex, colIndex, value: isNull ? '' : formatCell(cell), isNull });
    },
    [paginatedRows],
  );

  const commitEdit = useCallback(() => {
    if (!editingCell) {
      setEditingCell(null);
      return;
    }
    const { rowIndex, colIndex, isNull } = editingCell;
    const actualRowIndex = paginatedIndexMap[rowIndex];
    const row = result.rows[actualRowIndex];
    const column = result.columns[colIndex];
    const cell = row.cells[colIndex];
    const oldValue: string | number | boolean | null = cell.type === 'Null' ? null : formatCell(cell);
    const newValue: string | number | boolean | null = isNull ? null : editingCell.value;
    if (oldValue === newValue) {
      setEditingCell(null);
      return;
    }
    if (database && table) {
      const primaryKeys: Record<string, string | number | boolean | null> = {};
      result.columns.forEach((col, i) => {
        if (col.is_primary_key) primaryKeys[col.name] = formatCell(row.cells[i]);
      });
      if (Object.keys(primaryKeys).length > 0) {
        addChange({
          type: 'edit', table, database, rowIndex: actualRowIndex, primaryKeys,
          column: column.name, oldValue, newValue,
        });
      }
    }
    setEditingCell(null);
  }, [editingCell, result, database, table, addChange, paginatedIndexMap]);

  const cancelEdit = useCallback(() => setEditingCell(null), []);

  // Commit current edit and move to an adjacent cell
  const commitAndMove = useCallback((direction: 'right' | 'left' | 'down') => {
    if (!editingCell) return;
    // Commit first (inline logic to avoid async timing issues)
    const { rowIndex, colIndex, isNull } = editingCell;
    const actualRowIndex = paginatedIndexMap[rowIndex];
    const row = result.rows[actualRowIndex];
    const column = result.columns[colIndex];
    const cell = row.cells[colIndex];
    const oldValue: string | number | boolean | null = cell.type === 'Null' ? null : formatCell(cell);
    const newValue: string | number | boolean | null = isNull ? null : editingCell.value;
    if (oldValue !== newValue && database && table) {
      const primaryKeys: Record<string, string | number | boolean | null> = {};
      result.columns.forEach((col, i) => {
        if (col.is_primary_key) primaryKeys[col.name] = formatCell(row.cells[i]);
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

    if (nextRow >= 0 && nextRow < paginatedRows.length) {
      const nextColIdx = visibleColIndexMap[nextVisIdx];
      const nextCell = paginatedRows[nextRow].cells[nextColIdx];
      const nextIsNull = nextCell.type === 'Null';
      setEditingCell({ rowIndex: nextRow, colIndex: nextColIdx, value: nextIsNull ? '' : formatCell(nextCell), isNull: nextIsNull });
    } else {
      setEditingCell(null);
    }
  }, [editingCell, paginatedIndexMap, paginatedRows, result, database, table, addChange, visibleColumns, visibleColIndexMap]);

  const handleDeleteRow = useCallback((paginatedIdx: number) => {
    if (!database || !table) return;
    const actualRowIndex = paginatedIndexMap[paginatedIdx];
    const row = result.rows[actualRowIndex];
    const primaryKeys: Record<string, string | number | boolean | null> = {};
    const originalRow: Record<string, string | number | boolean | null> = {};
    result.columns.forEach((col, i) => {
      if (col.is_primary_key) primaryKeys[col.name] = formatCell(row.cells[i]);
      originalRow[col.name] = formatCell(row.cells[i]);
    });
    if (Object.keys(primaryKeys).length === 0) return;
    addChange({ type: 'delete', table, database, rowIndex: actualRowIndex, primaryKeys, originalRow });
    setContextMenu(null);
  }, [database, table, result, addChange, paginatedIndexMap]);

  const formatRowsForCopy = useCallback((columns: typeof result.columns, rows: typeof paginatedRows) => {
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
        const row = paginatedRows[rowIndex];
        if (!row) return;
        const col = result.columns[colIndex];
        const cell = row.cells[colIndex];
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
        const rows = rowIndices.map((ri) => ({
          cells: colIndices.map((ci) => paginatedRows[ri].cells[ci]),
        }));
        copyToClipboard(formatRowsForCopy(cols, rows as any));
      }
      return;
    }
    // Row selection
    if (selectedRows.size === 0) return;
    const sortedIndices = [...selectedRows].sort((a, b) => a - b);
    const rows = sortedIndices.map((idx) => paginatedRows[idx]);
    copyToClipboard(formatRowsForCopy(result.columns, rows));
  }, [selectedCells, selectedRows, result, paginatedRows, defaultCopyFormat, formatRowsForCopy]);

  const getSelectedOrContextRows = useCallback((contextRowIndex: number) => {
    if (selectedRows.size > 0) {
      return [...selectedRows].sort((a, b) => a - b).map((idx) => paginatedRows[idx]);
    }
    return [paginatedRows[contextRowIndex]];
  }, [selectedRows, paginatedRows]);

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
    return rowIndices.map((ri) => ({
      cells: colIndices.map((ci) => paginatedRows[ri].cells[ci]),
    })) as typeof paginatedRows;
  }, [selectedCells, paginatedRows]);

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
      for (let i = 0; i < paginatedRows.length; i++) all.add(i);
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
      else if (selectedCells.size > 0) { setSelectedCells(new Set()); setLastSelectedCellKey(null); }
      else setSelectedRows(new Set());
      return;
    }
    // Quick Look
    if (matchesBinding(e, getBinding('grid.quickLook')) && !editingCell) {
      e.preventDefault();
      if (selectedRows.size === 1) {
        const rowIdx = [...selectedRows][0];
        const row = paginatedRows[rowIdx];
        if (row) {
          const colIdx = focusedColIndex < result.columns.length ? focusedColIndex : 0;
          const col = result.columns[colIdx];
          const cell = row.cells[colIdx];
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
          ? Math.min(lastSelectedCellKey.rowIndex + 1, paginatedRows.length - 1)
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
        ? Math.min(current + 1, paginatedRows.length - 1)
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
  }, [copySelection, paginatedRows, editingCell, cancelEdit, lastSelectedRow, contextMenu, focusedColIndex, result.columns, selectedRows, selectedCells, lastSelectedCellKey, database, table, handleDuplicateRow, handlePasteRows]);

  // ─── Export ────────────────────────────────────────────────────────────────

  const exportData = useCallback(async (format: 'csv' | 'json' | 'sql') => {
    const dataRows = selectedRows.size > 0
      ? [...selectedRows].sort((a, b) => a - b).map((i) => paginatedRows[i])
      : paginatedRows;
    const cols = result.columns;
    let content: string;
    let filename: string;

    if (format === 'csv') {
      const header = cols.map((c) => `"${c.name}"`).join(',');
      const rows = dataRows.map((row) =>
        row.cells.map((cell) => {
          const val = formatCell(cell);
          return `"${val.replace(/"/g, '""')}"`;
        }).join(',')
      );
      content = [header, ...rows].join('\n');
      filename = `${table ?? 'export'}.csv`;
    } else if (format === 'json') {
      const data = dataRows.map((row) => {
        const obj: Record<string, string> = {};
        row.cells.forEach((cell, i) => {
          obj[cols[i].name] = formatCell(cell);
        });
        return obj;
      });
      content = JSON.stringify(data, null, 2);
      filename = `${table ?? 'export'}.json`;
    } else {
      const tableName = table ?? 'table_name';
      const colNames = cols.map((c) => `\`${c.name}\``).join(', ');
      const rows = dataRows.map((row) => {
        const values = row.cells.map((cell) => {
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
  }, [selectedRows, result, paginatedRows, table]);

  // ─── Pagination helpers ────────────────────────────────────────────────────

  const handlePageSizeChange = useCallback((size: number) => {
    setPageSize(size);
    setCurrentPage(0);
    try {
      localStorage.setItem('dataforge:pageSize', size === Infinity ? 'all' : String(size));
    } catch {}
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
      <div className="sticky top-0 z-10 flex border-b-2 border-border bg-muted" style={{ minWidth: totalContentWidth }}>
        <div className="flex w-[50px] shrink-0 items-center justify-center border-r border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          #
        </div>
        {visibleColumns.map((col, visIdx) => {
          const colIdx = visibleColIndexMap[visIdx];
          const width = getColWidth(colIdx);
          const sortDir = getSortDirection(colIdx);

          return (
            <div
              key={col.name}
              className="relative flex shrink-0 items-center gap-1 border-r border-border px-2 py-1.5 cursor-pointer hover:bg-accent/30"
              style={{ width }}
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
      <div className="sticky top-[calc(2rem+8px)] z-10 flex items-center gap-2 border-b border-border bg-card px-2 py-1" style={{ minWidth: totalContentWidth }}>
        <Search className="h-3 w-3 text-muted-foreground" />
        <input
          className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
          placeholder="Filter rows..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
        {filterText && (
          <button onClick={() => setFilterText('')} className="text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        )}
        <span className="text-[10px] text-muted-foreground">
          {totalSortedRows}/{result.rows.length}
        </span>
      </div>

      {/* Virtualized body */}
      <div
        className="relative"
        style={{ height: `${rowVirtualizer.getTotalSize()}px`, minWidth: totalContentWidth }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = paginatedRows[virtualRow.index];
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
                minWidth: totalContentWidth,
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
                const width = getColWidth(colIdx);
                const cell = row.cells[colIdx];
                const isEditing =
                  editingCell?.rowIndex === virtualRow.index &&
                  editingCell?.colIndex === colIdx;
                const pendingEdit = getCellPendingEdit(actualRowIndex, col.name);

                const isCellSelected = selectedCells.has(cellKey(virtualRow.index, colIdx));

                return (
                  <div
                    key={colIdx}
                    className={cn(
                      'flex shrink-0 items-center border-r border-border/30',
                      isEditing && 'ring-2 ring-inset ring-primary',
                      !isEditing && isCellSelected && 'ring-2 ring-inset ring-primary/60 bg-primary/10',
                      pendingEdit && !isEditing && 'bg-yellow-500/15',
                    )}
                    style={{ width }}
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
          style={{ height: 32, minWidth: totalContentWidth }}
        >
          <div className="flex w-[50px] shrink-0 items-center justify-center border-r border-border bg-green-500/10 text-[10px] text-green-600">
            +{idx + 1}
          </div>
          {visibleColumns.map((col, visIdx) => {
            const colIdx = visibleColIndexMap[visIdx];
            const width = getColWidth(colIdx);
            return (
              <div
                key={col.name}
                className="flex shrink-0 items-center border-r border-border px-2 text-xs text-green-600 dark:text-green-400"
                style={{ width }}
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
      {result.rows.length > 0 && (
        <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-muted px-3 py-1 text-[11px] text-muted-foreground" style={{ minWidth: totalContentWidth }}>
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
                const row = paginatedRows[contextMenu.rowIndex];
                if (row) {
                  const colIdx = contextMenu.colIndex;
                  const col = result.columns[colIdx];
                  const cell = row.cells[colIdx];
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
                for (let i = 0; i < paginatedRows.length; i++) all.add(i);
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
                const row = paginatedRows[contextMenu.rowIndex];
                const value = formatCell(row.cells[contextMenu.colIndex]);
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
              const row = paginatedRows[contextMenu.rowIndex];
              const cell = row?.cells[contextMenu.colIndex];
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
}

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
