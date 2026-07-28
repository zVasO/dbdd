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

const INTEGER_DATA_TYPES = new Set(['SmallInt', 'Integer', 'BigInt', 'Serial', 'BigSerial']);
const FLOAT_DATA_TYPES = new Set(['Float', 'Double']);
const JSON_DATA_TYPES = new Set(['Json', 'Jsonb']);

/**
 * Mirrors the Rust `column_kind_for_data_type` (purrql-core columnar.rs)
 * mapping from a column's declared `data_type` to a `ColumnData['kind']`.
 * Unit variants (e.g. `DataType::Integer`) arrive as a bare string; variants
 * with fields (e.g. `DataType::Decimal { .. }`) arrive as a single-key object
 * — either way the variant name is the discriminant. `Decimal` (and anything
 * else not explicitly numeric/boolean/json) stays `Strings`, matching how
 * every driver decodes it (Postgres/MySQL keep decimals as text to avoid
 * precision loss).
 *
 * Used only as a fallback when `meta.column_kinds` is absent — the backend
 * now sends the authoritative kind directly (see `initStream`) so the normal
 * path never depends on this duplicating the Rust mapping exactly.
 */
function dataTypeToColumnKind(dataType: string | Record<string, unknown>): ColumnData['kind'] {
  const variant = typeof dataType === 'string' ? dataType : Object.keys(dataType)[0];
  if (INTEGER_DATA_TYPES.has(variant)) return 'Integers';
  if (FLOAT_DATA_TYPES.has(variant)) return 'Floats';
  if (variant === 'Boolean') return 'Booleans';
  if (JSON_DATA_TYPES.has(variant)) return 'Json';
  return 'Strings';
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
        // For non-string types stored as a Strings column, convert to string.
        // Bytes/Array/Json are objects — String() would yield "[object Object]".
        if (kind === 'Strings' && typeof cell.value !== 'string') {
          if (cell.type === 'Bytes') {
            values[r] = cell.value.preview;
          } else if (cell.type === 'Json' || cell.type === 'Array') {
            values[r] = JSON.stringify(cell.value);
          } else {
            values[r] = String(cell.value);
          }
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
/**
 * Rows buffered before merging into the store. Also the chunk size requested
 * from the backend, so one emitted chunk maps to exactly one flush.
 */
export const FLUSH_THRESHOLD = 5000;

interface StreamBuffer {
  pendingChunks: ColumnData[][];
  pendingRowCount: number;
}

const streamBuffers = new Map<string, StreamBuffer>();

/**
 * Append column-data chunks onto the accumulated base.
 * Values are pushed into the existing per-column arrays in place: reallocating
 * a full array each flush would copy all prior rows again, making the whole
 * stream O(n^2). New column/array wrappers are returned so store selectors
 * still see a changed reference.
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
    const values = col.values as unknown[];
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunkCol = chunks[ci][colIdx];
      if (chunkCol) {
        const chunkValues = chunkCol.values as unknown[];
        for (let i = 0; i < chunkValues.length; i++) values.push(chunkValues[i]);
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
  /** Terminal state for a cancelled query: not an error, but whatever is shown is not the answer */
  markCancelled: (tabId: string) => void;
  setActiveResultIndex: (tabId: string, index: number) => void;
  initStream: (tabId: string, meta: StreamMeta) => void;
  appendChunk: (tabId: string, offset: number, chunkData: ColumnData[]) => void;
  /** `partial` marks a stream that stopped early (cancelled) so the tab shows it needs a re-run */
  finishStream: (tabId: string, totalRows: number, executionTimeMs: number, partial?: boolean) => void;
  updateLastAccessed: (tabId: string) => void;
  clearResult: (tabId: string) => void;
  clearAll: () => void;

  /** Lazy row accessor — builds rows on first access, caches for subsequent reads */
  getRows: (tabId: string) => QueryResult['rows'];
  getAllResults: (tabId: string) => QueryResult[];
  /** Active result WITHOUT materialized rows — for the grid, which reads columnar data directly */
  getActiveResult: (tabId: string) => QueryResult | null;
  /** First `limit` rows of the active result — for previews, without materializing everything */
  getRowsPreview: (tabId: string, limit: number) => QueryResult['rows'];
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

  markCancelled: (tabId) => {
    set((s) => {
      const current = s.results[tabId];
      if (!current) return s;
      return {
        results: {
          ...s.results,
          [tabId]: {
            ...current,
            isExecuting: false,
            isStreaming: false,
            isStale: true,
            error: null,
          },
        },
      };
    });
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
    // since total row count is unknown at stream start. Prefer the kind the
    // backend already computed (meta.column_kinds, same source as every
    // chunk's ColumnData) over re-deriving one from data_type.
    const emptyData: ColumnData[] = meta.columns.map((col, idx) => {
      const kind = meta.column_kinds?.[idx] ?? dataTypeToColumnKind(col.data_type);
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

  finishStream: (tabId, totalRows, executionTimeMs, partial = false) => {
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
          isStale: partial,
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
      set((s) => {
        const existing = s.results[tabId];
        if (!existing) return s;
        return { results: { ...s.results, [tabId]: { ...existing, _rowsCache: rows } } };
      });
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
      set((s) => {
        const existing = s.results[tabId];
        if (!existing) return s;
        return { results: { ...s.results, [tabId]: { ...existing, _allResultsCache: allResults } } };
      });
      return allResults;
    }

    return [];
  },

  getActiveResult: (tabId) => {
    const current = get().results[tabId];
    if (!current) return null;
    const columnar = current.allColumnarResults[current.activeResultIndex];
    if (!columnar) return null;
    return {
      query_id: columnar.query_id,
      columns: columnar.columns,
      rows: [],
      total_rows: columnar.row_count,
      affected_rows: columnar.affected_rows,
      execution_time_ms: columnar.execution_time_ms,
      warnings: columnar.warnings,
      result_type: columnar.result_type,
    };
  },

  getRowsPreview: (tabId, limit) => {
    const current = get().results[tabId];
    if (!current || current.data.length === 0) return [];
    return columnarToRows(current.columns, current.data, Math.min(limit, current.rowCount));
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
