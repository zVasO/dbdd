import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Key, Plus, Search, Trash2, X, Filter } from 'lucide-react';
import type { QueryResult, CellValue } from '@/lib/types';
import { useChangeStore } from '@/stores/changeStore';
import { useFilterStore } from '@/stores/filterStore';
import type { RowInsert } from '@/stores/changeStore';
import { Button } from '@/components/ui/button';

interface Props {
  result: QueryResult;
  database?: string;
  table?: string;
}

interface EditingCell {
  rowIndex: number;
  colIndex: number;
  value: string;
}

export function DataGrid({ result, database, table }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [lastSelectedRow, setLastSelectedRow] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Filter state
  const [filterText, setFilterText] = useState('');

  // Drag selection state
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartRow, setDragStartRow] = useState<number | null>(null);

  // Context menu state (colIndex is for Quick Filter)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; rowIndex: number; colIndex: number } | null>(null);

  // Change tracking
  const addChange = useChangeStore((s) => s.addChange);
  const pendingChanges = useChangeStore((s) =>
    database && table ? s.getPendingForTable(database, table) : []
  );

  // Column visibility
  const columnVisibility = useFilterStore((s) => s.columnVisibility);
  const visibleColumns = useMemo(
    () => result.columns.filter((col) => columnVisibility[col.name] !== false),
    [result.columns, columnVisibility],
  );
  // Map from visible column index to the original column index in result.columns
  const visibleColIndexMap = useMemo(
    () => visibleColumns.map((col) => result.columns.indexOf(col)),
    [visibleColumns, result.columns],
  );

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

  // Insert row handler
  const handleInsertRow = useCallback(() => {
    if (!database || !table) return;
    const values: Record<string, any> = {};
    result.columns.forEach((col) => {
      values[col.name] = null;
    });
    addChange({ type: 'insert', table, database, values });
  }, [database, table, result.columns, addChange]);

  // Extract inserted rows from pending changes
  const insertedRows = pendingChanges.filter((c): c is RowInsert => c.type === 'insert');

  // filteredRows + a map from filtered index -> original index in result.rows
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

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 20,
  });

  // Focus the input when entering edit mode
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  // Global mouseup listener to end drag selection
  useEffect(() => {
    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleRowMouseDown = useCallback(
    (e: React.MouseEvent, rowIndex: number) => {
      if (editingCell) return;

      if (e.shiftKey && lastSelectedRow !== null) {
        const start = Math.min(lastSelectedRow, rowIndex);
        const end = Math.max(lastSelectedRow, rowIndex);
        const next = new Set<number>();
        for (let i = start; i <= end; i++) {
          next.add(i);
        }
        setSelectedRows(next);
      } else if (e.ctrlKey || e.metaKey) {
        setSelectedRows((prev) => {
          const next = new Set(prev);
          if (next.has(rowIndex)) {
            next.delete(rowIndex);
          } else {
            next.add(rowIndex);
          }
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
      for (let i = start; i <= end; i++) {
        next.add(i);
      }
      setSelectedRows(next);
    },
    [isDragging, dragStartRow],
  );

  const handleCellDoubleClick = useCallback(
    (rowIndex: number, colIndex: number) => {
      const cell = filteredRows[rowIndex].cells[colIndex];
      setEditingCell({
        rowIndex,
        colIndex,
        value: formatCell(cell),
      });
    },
    [filteredRows],
  );

  const commitEdit = useCallback(() => {
    if (!editingCell) {
      setEditingCell(null);
      return;
    }

    const { rowIndex, colIndex } = editingCell;
    // rowIndex here is the filtered index; map to original
    const actualRowIndex = filteredIndexMap[rowIndex];
    const row = result.rows[actualRowIndex];
    const column = result.columns[colIndex];
    const oldValue = formatCell(row.cells[colIndex]);
    const newValue = editingCell.value;

    if (oldValue === newValue) {
      setEditingCell(null);
      return;
    }

    if (database && table) {
      // Build primary key map
      const primaryKeys: Record<string, string | number | boolean | null> = {};
      result.columns.forEach((col, i) => {
        if (col.is_primary_key) {
          primaryKeys[col.name] = formatCell(row.cells[i]);
        }
      });

      if (Object.keys(primaryKeys).length > 0) {
        addChange({
          type: 'edit',
          table,
          database,
          rowIndex: actualRowIndex,
          primaryKeys,
          column: column.name,
          oldValue,
          newValue,
        });
      }
    }

    setEditingCell(null);
  }, [editingCell, result, database, table, addChange, filteredIndexMap]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleDeleteRow = useCallback((filteredIdx: number) => {
    if (!database || !table) return;
    const actualRowIndex = filteredIndexMap[filteredIdx];
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
  }, [database, table, result, addChange, filteredIndexMap]);

  const copySelectedRows = useCallback(() => {
    if (selectedRows.size === 0) return;
    const sortedIndices = [...selectedRows].sort((a, b) => a - b);
    const header = result.columns.map((c) => c.name).join('\t');
    const rows = sortedIndices.map((idx) =>
      filteredRows[idx].cells.map((cell) => formatCell(cell)).join('\t')
    );
    navigator.clipboard.writeText([header, ...rows].join('\n'));
  }, [selectedRows, result, filteredRows]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Ctrl+C
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      e.preventDefault();
      copySelectedRows();
      return;
    }
    // Ctrl+A
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      const all = new Set<number>();
      for (let i = 0; i < filteredRows.length; i++) all.add(i);
      setSelectedRows(all);
      return;
    }
    // Escape
    if (e.key === 'Escape') {
      if (contextMenu) { setContextMenu(null); return; }
      if (editingCell) cancelEdit();
      else setSelectedRows(new Set());
      return;
    }
    // Arrow navigation
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const current = lastSelectedRow ?? -1;
      const next = e.key === 'ArrowDown'
        ? Math.min(current + 1, filteredRows.length - 1)
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
  }, [copySelectedRows, filteredRows.length, editingCell, cancelEdit, lastSelectedRow, contextMenu]);

  const exportData = useCallback((format: 'csv' | 'json' | 'sql') => {
    const dataRows = selectedRows.size > 0
      ? [...selectedRows].sort((a, b) => a - b).map((i) => filteredRows[i])
      : filteredRows;
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
      filename = 'export.csv';
    } else if (format === 'json') {
      const data = dataRows.map((row) => {
        const obj: Record<string, string> = {};
        row.cells.forEach((cell, i) => {
          obj[cols[i].name] = formatCell(cell);
        });
        return obj;
      });
      content = JSON.stringify(data, null, 2);
      filename = 'export.json';
    } else {
      // SQL INSERT
      const tableName = 'table_name';
      const colNames = cols.map((c) => `\`${c.name}\``).join(', ');
      const rows = dataRows.map((row) => {
        const values = row.cells.map((cell) => {
          if (cell.type === 'Null') return 'NULL';
          if (cell.type === 'Integer' || cell.type === 'Float') return String(cell.value);
          if (cell.type === 'Boolean') return cell.value ? '1' : '0';
          return `'${formatCell(cell).replace(/'/g, "''")}'`;
        }).join(', ');
        return `INSERT INTO ${tableName} (${colNames}) VALUES (${values});`;
      });
      content = rows.join('\n');
      filename = 'export.sql';
    }

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [selectedRows, result, filteredRows]);

  return (
    <div
      ref={parentRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full select-none overflow-auto bg-background outline-none focus:outline-none"
      style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
      onScroll={() => { if (contextMenu) setContextMenu(null); }}
      onClick={(e) => {
        if (e.target === parentRef.current) {
          setSelectedRows(new Set());
        }
      }}
    >
      {/* Column headers */}
      <div className="sticky top-0 z-10 flex border-b-2 border-border bg-muted">
        {/* Row number header */}
        <div className="flex w-[50px] shrink-0 items-center justify-center border-r border-border px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          #
        </div>
        {visibleColumns.map((col) => (
          <div
            key={col.name}
            className="flex w-[180px] shrink-0 items-center gap-1 border-r border-border px-2 py-1.5"
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
                  {col.native_type}
                </Badge>
                {col.nullable && (
                  <span className="text-[9px] text-muted-foreground">null</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="sticky top-[calc(2rem+8px)] z-10 flex items-center gap-2 border-b border-border bg-card px-2 py-1">
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
          {filteredRows.length}/{result.rows.length}
        </span>
      </div>

      {/* Virtualized body */}
      <div
        className="relative w-full"
        style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = filteredRows[virtualRow.index];
          const actualRowIndex = filteredIndexMap[virtualRow.index];
          const isOdd = virtualRow.index % 2 === 1;
          const isSelected = selectedRows.has(virtualRow.index);
          const rowDeleted = isRowDeleted(actualRowIndex);

          return (
            <div
              key={virtualRow.index}
              className={cn(
                'absolute left-0 top-0 flex w-full cursor-pointer border-b border-border/30',
                rowDeleted
                  ? 'opacity-40'
                  : isSelected
                    ? 'bg-primary/15 hover:bg-primary/20'
                    : isOdd
                      ? 'bg-muted/20 hover:bg-muted/40'
                      : 'hover:bg-muted/30',
              )}
              style={{
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              onMouseDown={(e) => handleRowMouseDown(e, virtualRow.index)}
              onMouseEnter={() => handleRowMouseEnter(virtualRow.index)}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selectedRows.has(virtualRow.index)) {
                  setSelectedRows(new Set([virtualRow.index]));
                  setLastSelectedRow(virtualRow.index);
                }
                setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: virtualRow.index, colIndex: 0 });
              }}
            >
              {/* Row number */}
              <div
                className={cn(
                  'flex w-[50px] shrink-0 items-center justify-center border-r border-border/30 text-[10px]',
                  isSelected ? 'font-semibold text-primary' : 'text-muted-foreground',
                  rowDeleted && 'line-through',
                )}
              >
                {virtualRow.index + 1}
              </div>

              {/* Cells */}
              {visibleColumns.map((col, visIdx) => {
                const colIdx = visibleColIndexMap[visIdx];
                const cell = row.cells[colIdx];
                const isEditing =
                  editingCell?.rowIndex === virtualRow.index &&
                  editingCell?.colIndex === colIdx;
                const pendingEdit = getCellPendingEdit(actualRowIndex, col.name);

                return (
                  <div
                    key={colIdx}
                    className={cn(
                      'flex w-[180px] shrink-0 items-center border-r border-border/30',
                      isEditing && 'ring-2 ring-inset ring-primary',
                      pendingEdit && !isEditing && 'bg-yellow-500/15',
                    )}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedRows.has(virtualRow.index)) {
                        setSelectedRows(new Set([virtualRow.index]));
                        setLastSelectedRow(virtualRow.index);
                      }
                      setContextMenu({ x: e.clientX, y: e.clientY, rowIndex: virtualRow.index, colIndex: colIdx });
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!rowDeleted) handleCellDoubleClick(virtualRow.index, colIdx);
                    }}
                  >
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        className="h-full w-full border-none bg-background px-2 py-1 text-foreground outline-none"
                        style={{ fontFamily: 'inherit', fontSize: 'inherit' }}
                        value={editingCell.value}
                        onChange={(e) =>
                          setEditingCell((prev) =>
                            prev ? { ...prev, value: e.target.value } : null,
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEdit();
                          if (e.key === 'Escape') cancelEdit();
                          e.stopPropagation();
                        }}
                        onBlur={commitEdit}
                      />
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
                                    : 'text-foreground',
                        )}
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
          style={{ height: 32 }}
        >
          {/* Row number */}
          <div
            className="flex w-[50px] shrink-0 items-center justify-center border-r border-border bg-green-500/10 text-[10px] text-green-600"
          >
            +{idx + 1}
          </div>
          {/* Cells */}
          {visibleColumns.map((col) => (
            <div
              key={col.name}
              className="flex w-[180px] shrink-0 items-center border-r border-border px-2 text-xs text-green-600 dark:text-green-400"
            >
              {insert.values[col.name] === null ? (
                <span className="italic text-green-400/60">NULL</span>
              ) : (
                String(insert.values[col.name])
              )}
            </div>
          ))}
        </div>
      ))}

      {/* Footer summary */}
      {result.rows.length > 0 && (
        <div className="sticky bottom-0 flex items-center gap-3 border-t border-border bg-muted px-3 py-1 text-[11px] text-muted-foreground">
          <span>{result.total_rows ?? result.rows.length} rows</span>
          {selectedRows.size > 0 && (
            <span className="text-primary">{selectedRows.size} selected</span>
          )}
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
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => { copySelectedRows(); setContextMenu(null); }}
            >
              Copy Rows
              <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+C</kbd>
            </button>
            <button
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                const all = new Set<number>();
                for (let i = 0; i < filteredRows.length; i++) all.add(i);
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
                const row = filteredRows[contextMenu.rowIndex];
                const value = formatCell(row.cells[contextMenu.colIndex]);
                handleQuickFilter(col.name, value);
                setContextMenu(null);
              }}
            >
              <Filter className="h-3.5 w-3.5" />
              Quick Filter
              <kbd className="ml-auto text-[10px] text-muted-foreground">Ctrl+F</kbd>
            </button>
            {database && table && (
              <>
                <div className="my-1 h-px bg-border" />
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
