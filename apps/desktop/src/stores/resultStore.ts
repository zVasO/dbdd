import { create } from 'zustand';
import type { QueryResult, ColumnMeta, ColumnarResult, ColumnData, StreamMeta, ResultType } from '../lib/types';
import { estimateTabMemory, selectEvictionCandidates } from '../lib/memory-manager';
import type { TabMemoryEntry } from '../lib/memory-manager';

// Callback to resolve adjacent tab IDs — set by queryStore to avoid circular imports
let _getAdjacentTabIds: ((tabId: string) => string[]) | null = null;

/** Called by queryStore at init time to wire up adjacent tab resolution */
export function registerAdjacentTabResolver(fn: (tabId: string) => string[]): void {
  _getAdjacentTabIds = fn;
}

function getAdjacentTabIds(tabId: string): string[] {
  return _getAdjacentTabIds?.(tabId) ?? [];
}

export interface TabResult {
  columns: ColumnMeta[];
  /** Columnar data — the primary storage format */
  data: ColumnData[];
  rowCount: number;
  executionTimeMs: number;
  /** @deprecated Use rowCount — kept for backward compat */
  totalRows: number;
  isExecuting: boolean;
  isStreaming: boolean;
  /** Number of rows received so far during streaming */
  streamProgress: number;
  error: string | null;
  /** Full results for multi-statement (kept as ColumnarResult[]) */
  allColumnarResults: ColumnarResult[];
  activeResultIndex: number;
  /** Metadata preserved from stream init for finishStream */
  _streamResultType: ResultType | null;
  _streamQueryId: string | null;
  _streamWarnings: string[];
  /** Whether this tab's data was evicted by memory management */
  isStale: boolean;
  /** Legacy: row-based view built lazily on first access */
  _rowsCache: QueryResult['rows'] | null;
  _allResultsCache: QueryResult[] | null;
}

/** Build a single cell from columnar data */
function mapCell(col: ColumnData, r: number) {
  const val = col.values[r];
  if (val === null || val === undefined) return { type: 'Null' as const };
  switch (col.kind) {
    case 'Integers': return { type: 'Integer' as const, value: val as number };
    case 'Floats': return { type: 'Float' as const, value: val as number };
    case 'Booleans': return { type: 'Boolean' as const, value: val as boolean };
    case 'Strings': return { type: 'Text' as const, value: val as string };
    case 'Json': return { type: 'Json' as const, value: val };
  }
}

/** Lazily convert columnar data to row-based format */
function columnarToRows(columns: ColumnMeta[], data: ColumnData[], rowCount: number): QueryResult['rows'] {
  const rows: { cells: ReturnType<typeof mapCell>[] }[] = [];
  for (let r = 0; r < rowCount; r++) {
    const cells = data.map((col) => mapCell(col, r));
    rows.push({ cells });
  }
  return rows;
}

/** Build a full QueryResult from columnar data */
function buildQueryResult(result: ColumnarResult): QueryResult {
  const rows = columnarToRows(result.columns, result.data, result.row_count);
  return {
    query_id: result.query_id,
    columns: result.columns,
    rows,
    total_rows: result.row_count,
    affected_rows: result.affected_rows,
    execution_time_ms: result.execution_time_ms,
    warnings: result.warnings,
    result_type: result.result_type,
  };
}

/** Map a CellValue type to ColumnData kind */
function cellTypeToColumnKind(cellType: string): ColumnData['kind'] {
  switch (cellType) {
    case 'Integer': return 'Integers';
    case 'Float': return 'Floats';
    case 'Boolean': return 'Booleans';
    case 'Json': return 'Json';
    default: return 'Strings';
  }
}

/** Convert row-based QueryResult to ColumnarResult (reverse of buildQueryResult) */
function queryResultToColumnar(result: QueryResult): ColumnarResult {
  const rowCount = result.rows.length;
  const colCount = result.columns.length;

  // Infer column kinds from first non-null cell in each column
  const kinds: ColumnData['kind'][] = result.columns.map((_, colIdx) => {
    for (let r = 0; r < rowCount; r++) {
      const cell = result.rows[r]?.cells[colIdx];
      if (cell && cell.type !== 'Null') {
        return cellTypeToColumnKind(cell.type);
      }
    }
    return 'Strings'; // Default to Strings for all-null columns
  });

  // Build columnar data
  const data: ColumnData[] = kinds.map((kind, colIdx) => {
    const values = new Array(rowCount);
    for (let r = 0; r < rowCount; r++) {
      const cell = result.rows[r]?.cells[colIdx];
      if (!cell || cell.type === 'Null') {
        values[r] = null;
      } else if ('value' in cell) {
        // For non-string types stored as Strings column, convert to string
        if (kind === 'Strings' && typeof cell.value !== 'string') {
          values[r] = cell.type === 'Json' ? JSON.stringify(cell.value) : String(cell.value);
        } else {
          values[r] = cell.value;
        }
      } else {
        values[r] = null;
      }
    }
    return { kind, values } as ColumnData;
  });

  return {
    query_id: result.query_id,
    columns: result.columns,
    data,
    row_count: rowCount,
    affected_rows: result.affected_rows,
    execution_time_ms: result.execution_time_ms,
    warnings: result.warnings,
    result_type: result.result_type,
  };
}

/** Direct columnar cell access — O(1) per cell, no row conversion needed */
export function getColumnarCell(data: ColumnData[], colIdx: number, rowIdx: number): { type: string; value: unknown } {
  const col = data[colIdx];
  if (!col) return { type: 'Null', value: null };
  const val = col.values[rowIdx];
  if (val == null) return { type: 'Null', value: null };
  switch (col.kind) {
    case 'Integers': return { type: 'Integer', value: val };
    case 'Floats': return { type: 'Float', value: val };
    case 'Booleans': return { type: 'Boolean', value: val };
    case 'Strings': return { type: 'Text', value: val };
    case 'Json': return { type: 'Json', value: val };
    default: return { type: 'Null', value: null };
  }
}

/** Format a columnar cell value to string — mirrors formatCell but works with raw columnar data */
export function formatColumnarCell(data: ColumnData[], colIdx: number, rowIdx: number): string {
  const col = data[colIdx];
  if (!col) return 'NULL';
  const val = col.values[rowIdx];
  if (val == null) return 'NULL';
  switch (col.kind) {
    case 'Integers':
    case 'Floats': return String(val);
    case 'Booleans': return val ? 'true' : 'false';
    case 'Strings': return val as string;
    case 'Json': return JSON.stringify(val);
    default: return '';
  }
}

const EMPTY_COLUMNAR_DEFAULTS = {
  data: [] as ColumnData[],
  rowCount: 0,
  executionTimeMs: 0,
  allColumnarResults: [] as ColumnarResult[],
};

// --- Stream buffering (module-level, outside Zustand to avoid unnecessary re-renders) ---
const FLUSH_THRESHOLD = 5000;

interface StreamBuffer {
  pendingChunks: ColumnData[][];
  pendingRowCount: number;
}

const streamBuffers = new Map<string, StreamBuffer>();

/**
 * Efficiently merge multiple column-data chunks into a base array.
 * Pre-allocates the final array size to avoid O(n^2) spreading.
 */
function mergeColumnArrays(
  base: ColumnData[],
  chunks: ColumnData[][],
): { merged: ColumnData[]; addedRows: number } {
  if (chunks.length === 0) return { merged: base, addedRows: 0 };

  const addedRows = chunks.reduce(
    (sum, c) => sum + (c[0]?.values?.length ?? 0),
    0,
  );

  const merged = base.map((col, colIdx) => {
    const chunkLengths = chunks.map(
      (c) => c[colIdx]?.values?.length ?? 0,
    );
    const totalLen = col.values.length + chunkLengths.reduce((a, b) => a + b, 0);
    const values = new Array(totalLen) as unknown[];
    let offset = 0;
    for (let i = 0; i < col.values.length; i++) values[offset++] = col.values[i];
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunkCol = chunks[ci][colIdx];
      if (chunkCol) {
        for (let i = 0; i < chunkCol.values.length; i++) values[offset++] = chunkCol.values[i];
      }
    }
    return { ...col, values } as ColumnData;
  });

  return { merged, addedRows };
}

// --- Memory tracking ---
const memoryEntries = new Map<string, TabMemoryEntry>();

/** Track memory for a tab and evict LRU tabs if over the soft cap */
function trackAndEvict(
  tabId: string,
  data: ColumnData[],
  results: Record<string, TabResult>,
): Record<string, TabResult> {
  const bytes = estimateTabMemory(data);
  memoryEntries.set(tabId, {
    tabId,
    bytes,
    lastAccessed: Date.now(),
    pinned: false,
  });

  const adjacentIds = getAdjacentTabIds(tabId);
  const toEvict = selectEvictionCandidates(
    Array.from(memoryEntries.values()),
    tabId,
    adjacentIds,
  );

  if (toEvict.length === 0) return results;

  let updated = { ...results };
  for (const evictId of toEvict) {
    const existing = updated[evictId];
    if (existing) {
      updated = {
        ...updated,
        [evictId]: {
          ...existing,
          data: [],
          rowCount: 0,
          allColumnarResults: [],
          isStale: true,
          _rowsCache: null,
          _allResultsCache: null,
        },
      };
    }
    memoryEntries.delete(evictId);
  }
  return updated;
}

interface ResultState {
  results: Record<string, TabResult>;

  setExecuting: (tabId: string) => void;
  setResult: (tabId: string, result: QueryResult) => void;
  setResults: (tabId: string, results: QueryResult[], error: string | null) => void;
  setColumnarResult: (tabId: string, result: ColumnarResult) => void;
  setColumnarResults: (tabId: string, results: ColumnarResult[], error: string | null) => void;
  setError: (tabId: string, error: string) => void;
  setActiveResultIndex: (tabId: string, index: number) => void;
  initStream: (tabId: string, meta: StreamMeta) => void;
  appendChunk: (tabId: string, offset: number, chunkData: ColumnData[]) => void;
  finishStream: (tabId: string, totalRows: number, executionTimeMs: number) => void;
  updateLastAccessed: (tabId: string) => void;
  clearResult: (tabId: string) => void;
  clearAll: () => void;

  /** Lazy row accessor — builds rows on first access, caches for subsequent reads */
  getRows: (tabId: string) => QueryResult['rows'];
  getAllResults: (tabId: string) => QueryResult[];
}

export const useResultStore = create<ResultState>((set, get) => ({
  results: {},

  setExecuting: (tabId) => {
    set((s) => {
      const existing = s.results[tabId];
      return {
        results: {
          ...s.results,
          [tabId]: {
            // Preserve previous data so the grid stays mounted during re-query
            ...(existing ?? {
              ...EMPTY_COLUMNAR_DEFAULTS,
              columns: [],
              totalRows: 0,
              isStreaming: false,
              streamProgress: 0,
              isStale: false,
              activeResultIndex: 0,
              _streamResultType: null,
              _streamQueryId: null,
              _streamWarnings: [],
              _rowsCache: null,
              _allResultsCache: null,
            }),
            isExecuting: true,
            error: null,
          },
        },
      };
    });
  },

  setResult: (tabId, result) => {
    const columnar = queryResultToColumnar(result);
    set((s) => {
      const newTabResult: TabResult = {
        columns: result.columns,
        data: columnar.data,
        rowCount: result.rows.length,
        totalRows: result.rows.length,
        executionTimeMs: result.execution_time_ms,
        isExecuting: false,
        isStreaming: false,
        streamProgress: 0,
        isStale: false,
        error: null,
        allColumnarResults: [columnar],
        activeResultIndex: 0,
        _streamResultType: null,
        _streamQueryId: null,
        _streamWarnings: [],
        _rowsCache: result.rows,
        _allResultsCache: [result],
      };
      const updatedResults = { ...s.results, [tabId]: newTabResult };
      return { results: trackAndEvict(tabId, columnar.data, updatedResults) };
    });
  },

  setResults: (tabId, results, error) => {
    const columnarResults = results.map(queryResultToColumnar);
    const first = results[0] ?? null;
    const firstColumnar = columnarResults[0] ?? null;
    set((s) => {
      const newTabResult: TabResult = {
        columns: first?.columns ?? [],
        data: firstColumnar?.data ?? [],
        rowCount: firstColumnar?.row_count ?? 0,
        totalRows: first?.rows.length ?? 0,
        executionTimeMs: firstColumnar?.execution_time_ms ?? 0,
        isExecuting: false,
        isStreaming: false,
        streamProgress: 0,
        isStale: false,
        error,
        allColumnarResults: columnarResults,
        activeResultIndex: 0,
        _streamResultType: null,
        _streamQueryId: null,
        _streamWarnings: [],
        _rowsCache: first?.rows ?? [],
        _allResultsCache: results,
      };
      const updatedResults = { ...s.results, [tabId]: newTabResult };
      return { results: trackAndEvict(tabId, firstColumnar?.data ?? [], updatedResults) };
    });
  },

  setColumnarResult: (tabId, result) => {
    // Store columnar only — rows built lazily via getRows()
    set((s) => {
      const newTabResult: TabResult = {
        columns: result.columns,
        data: result.data,
        rowCount: result.row_count,
        totalRows: result.row_count,
        executionTimeMs: result.execution_time_ms,
        isExecuting: false,
        isStreaming: false,
        streamProgress: 0,
        isStale: false,
        error: null,
        allColumnarResults: [result],
        activeResultIndex: 0,
        _streamResultType: null,
        _streamQueryId: null,
        _streamWarnings: [],
        _rowsCache: null,
        _allResultsCache: null,
      };
      const updatedResults = { ...s.results, [tabId]: newTabResult };
      return { results: trackAndEvict(tabId, result.data, updatedResults) };
    });
  },

  setColumnarResults: (tabId, results, error) => {
    const first = results[0] ?? null;
    set((s) => {
      const newTabResult: TabResult = {
        columns: first?.columns ?? [],
        data: first?.data ?? [],
        rowCount: first?.row_count ?? 0,
        totalRows: first?.row_count ?? 0,
        executionTimeMs: first?.execution_time_ms ?? 0,
        isExecuting: false,
        isStreaming: false,
        streamProgress: 0,
        isStale: false,
        error,
        allColumnarResults: results,
        activeResultIndex: 0,
        _streamResultType: null,
        _streamQueryId: null,
        _streamWarnings: [],
        _rowsCache: null,
        _allResultsCache: null,
      };
      const updatedResults = { ...s.results, [tabId]: newTabResult };
      return { results: trackAndEvict(tabId, first?.data ?? [], updatedResults) };
    });
  },

  setError: (tabId, error) => {
    set((s) => ({
      results: {
        ...s.results,
        [tabId]: {
          ...(s.results[tabId] ?? {
            ...EMPTY_COLUMNAR_DEFAULTS,
            columns: [],
            totalRows: 0,
            isStreaming: false,
            streamProgress: 0,
            isStale: false,
            activeResultIndex: 0,
            _streamResultType: null,
            _streamQueryId: null,
            _streamWarnings: [],
            _rowsCache: null,
            _allResultsCache: null,
          }),
          isExecuting: false,
          isStreaming: false,
          error,
        },
      },
    }));
  },

  setActiveResultIndex: (tabId, index) => {
    set((s) => {
      const current = s.results[tabId];
      if (!current) return s;
      const columnarResult = current.allColumnarResults[index];
      if (!columnarResult) return s;
      return {
        results: {
          ...s.results,
          [tabId]: {
            ...current,
            columns: columnarResult.columns,
            activeResultIndex: index,
            data: columnarResult.data,
            rowCount: columnarResult.row_count,
            totalRows: columnarResult.row_count,
            executionTimeMs: columnarResult.execution_time_ms,
            _rowsCache: null,
            _allResultsCache: null,
          },
        },
      };
    });
  },

  initStream: (tabId, meta) => {
    // Create empty column arrays — rows will grow dynamically via appendChunk
    // since total row count is unknown at stream start
    const emptyData: ColumnData[] = meta.columns.map((col) => {
      const dataType = typeof col.data_type === 'string'
        ? col.data_type
        : 'string';
      const kind = dataType === 'integer' ? 'Integers'
        : dataType === 'float' ? 'Floats'
        : dataType === 'boolean' ? 'Booleans'
        : dataType === 'json' ? 'Json'
        : 'Strings';
      return { kind, values: [] } as ColumnData;
    });

    set((s) => ({
      results: {
        ...s.results,
        [tabId]: {
          columns: meta.columns,
          data: emptyData,
          rowCount: 0,
          executionTimeMs: 0,
          totalRows: 0,
          isExecuting: true,
          isStreaming: true,
          streamProgress: 0,
          isStale: false,
          error: null,
          allColumnarResults: [],
          activeResultIndex: 0,
          _streamResultType: (meta.result_type as ResultType) ?? 'Select',
          _streamQueryId: meta.query_id,
          _streamWarnings: [...meta.warnings],
          _rowsCache: null,
          _allResultsCache: null,
        },
      },
    }));
  },

  appendChunk: (tabId, _offset, chunkData) => {
    const chunkRowCount = chunkData[0]?.values?.length ?? 0;
    if (chunkRowCount === 0) return;

    let buffer = streamBuffers.get(tabId);
    if (!buffer) {
      buffer = { pendingChunks: [], pendingRowCount: 0 };
      streamBuffers.set(tabId, buffer);
    }
    buffer.pendingChunks.push(chunkData);
    buffer.pendingRowCount += chunkRowCount;

    // Flush when accumulated enough rows to reduce O(n^2) copies and re-renders
    if (buffer.pendingRowCount >= FLUSH_THRESHOLD) {
      const chunks = buffer.pendingChunks;
      const addedTotal = buffer.pendingRowCount;
      buffer.pendingChunks = [];
      buffer.pendingRowCount = 0;

      set((s) => {
        const current = s.results[tabId];
        if (!current) return s;
        const { merged } = mergeColumnArrays(current.data, chunks);
        const newRowCount = current.rowCount + addedTotal;
        return {
          results: {
            ...s.results,
            [tabId]: {
              ...current,
              data: merged,
              rowCount: newRowCount,
              totalRows: newRowCount,
              streamProgress: newRowCount,
              _rowsCache: null,
              _allResultsCache: null,
            },
          },
        };
      });
    }
  },

  finishStream: (tabId, totalRows, executionTimeMs) => {
    // Flush any remaining buffered chunks before finalizing
    const buffer = streamBuffers.get(tabId);
    const pendingChunks = buffer?.pendingChunks ?? [];
    streamBuffers.delete(tabId);

    set((s) => {
      const current = s.results[tabId];
      if (!current) return s;

      // Merge any remaining buffered data
      const { merged } = mergeColumnArrays(current.data, pendingChunks);

      const columnarResult: ColumnarResult = {
        query_id: current._streamQueryId ?? '',
        columns: current.columns,
        data: merged,
        row_count: totalRows,
        affected_rows: null,
        execution_time_ms: executionTimeMs,
        warnings: current._streamWarnings,
        result_type: current._streamResultType ?? 'Select',
      };

      const updatedResults = {
        ...s.results,
        [tabId]: {
          ...current,
          data: merged,
          isExecuting: false,
          isStreaming: false,
          isStale: false,
          rowCount: totalRows,
          totalRows: totalRows,
          executionTimeMs,
          streamProgress: totalRows,
          allColumnarResults: [columnarResult],
          _streamResultType: null,
          _streamQueryId: null,
          _streamWarnings: [],
          _rowsCache: null,
          _allResultsCache: null,
        },
      };

      return { results: trackAndEvict(tabId, merged, updatedResults) };
    });
  },

  /** Lazy row accessor: builds rows from columnar data on first call, caches result */
  getRows: (tabId) => {
    const current = get().results[tabId];
    if (!current) return [];

    // Return cached rows if available
    if (current._rowsCache) return current._rowsCache;

    // Build from columnar data
    if (current.data.length > 0 && current.rowCount > 0) {
      const rows = columnarToRows(current.columns, current.data, current.rowCount);
      // Cache the result (mutating is OK — doesn't affect React rendering)
      current._rowsCache = rows;
      return rows;
    }

    return [];
  },

  /** Lazy accessor for all row-based results */
  getAllResults: (tabId) => {
    const current = get().results[tabId];
    if (!current) return [];

    if (current._allResultsCache) return current._allResultsCache;

    if (current.allColumnarResults.length > 0) {
      const allResults = current.allColumnarResults.map(buildQueryResult);
      current._allResultsCache = allResults;
      return allResults;
    }

    return [];
  },

  updateLastAccessed: (tabId) => {
    const entry = memoryEntries.get(tabId);
    if (entry) {
      memoryEntries.set(tabId, { ...entry, lastAccessed: Date.now() });
    }
  },

  clearResult: (tabId) => {
    streamBuffers.delete(tabId);
    memoryEntries.delete(tabId);
    set((s) => {
      const { [tabId]: _, ...rest } = s.results;
      return { results: rest };
    });
  },

  clearAll: () => {
    streamBuffers.clear();
    memoryEntries.clear();
    set({ results: {} });
  },
}));
