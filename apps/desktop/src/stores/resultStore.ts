import { create } from 'zustand';
import type { QueryResult, ColumnMeta, ColumnarResult, ColumnData, StreamMeta, ResultType } from '../lib/types';

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

const EMPTY_COLUMNAR_DEFAULTS = {
  data: [] as ColumnData[],
  rowCount: 0,
  executionTimeMs: 0,
  allColumnarResults: [] as ColumnarResult[],
};

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
    set((s) => ({
      results: {
        ...s.results,
        [tabId]: {
          ...EMPTY_COLUMNAR_DEFAULTS,
          columns: result.columns,
          totalRows: result.rows.length,
          isExecuting: false,
          isStreaming: false,
          streamProgress: 0,
          error: null,
          activeResultIndex: 0,
          _streamResultType: null,
          _streamQueryId: null,
          _streamWarnings: [],
          _rowsCache: result.rows,
          _allResultsCache: [result],
        },
      },
    }));
  },

  setResults: (tabId, results, error) => {
    const first = results[0] ?? null;
    set((s) => ({
      results: {
        ...s.results,
        [tabId]: {
          ...EMPTY_COLUMNAR_DEFAULTS,
          columns: first?.columns ?? [],
          totalRows: first?.rows.length ?? 0,
          isExecuting: false,
          isStreaming: false,
          streamProgress: 0,
          error,
          activeResultIndex: 0,
          _streamResultType: null,
          _streamQueryId: null,
          _streamWarnings: [],
          _rowsCache: first?.rows ?? [],
          _allResultsCache: results,
        },
      },
    }));
  },

  setColumnarResult: (tabId, result) => {
    // Store columnar only — rows built lazily via getRows()
    set((s) => ({
      results: {
        ...s.results,
        [tabId]: {
          columns: result.columns,
          data: result.data,
          rowCount: result.row_count,
          totalRows: result.row_count,
          executionTimeMs: result.execution_time_ms,
          isExecuting: false,
          isStreaming: false,
          streamProgress: 0,
          error: null,
          allColumnarResults: [result],
          activeResultIndex: 0,
          _streamResultType: null,
          _streamQueryId: null,
          _streamWarnings: [],
          _rowsCache: null,
          _allResultsCache: null,
        },
      },
    }));
  },

  setColumnarResults: (tabId, results, error) => {
    const first = results[0] ?? null;
    set((s) => ({
      results: {
        ...s.results,
        [tabId]: {
          columns: first?.columns ?? [],
          data: first?.data ?? [],
          rowCount: first?.row_count ?? 0,
          totalRows: first?.row_count ?? 0,
          executionTimeMs: first?.execution_time_ms ?? 0,
          isExecuting: false,
          isStreaming: false,
          streamProgress: 0,
          error,
          allColumnarResults: results,
          activeResultIndex: 0,
          _streamResultType: null,
          _streamQueryId: null,
          _streamWarnings: [],
          _rowsCache: null,
          _allResultsCache: null,
        },
      },
    }));
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
    set((s) => {
      const current = s.results[tabId];
      if (!current) return s;

      const chunkRowCount = chunkData[0]?.values?.length ?? 0;
      if (chunkRowCount === 0) return s;

      // Concat chunk values onto existing arrays — creates new references for React reactivity
      const newData = current.data.map((col, i) => {
        const chunk = chunkData[i];
        if (!chunk) return col;
        return { ...col, values: [...col.values, ...chunk.values] } as ColumnData;
      });

      const newRowCount = current.rowCount + chunkRowCount;

      return {
        results: {
          ...s.results,
          [tabId]: {
            ...current,
            data: newData,
            rowCount: newRowCount,
            totalRows: newRowCount,
            streamProgress: newRowCount,
            _rowsCache: null,
            _allResultsCache: null,
          },
        },
      };
    });
  },

  finishStream: (tabId, totalRows, executionTimeMs) => {
    set((s) => {
      const current = s.results[tabId];
      if (!current) return s;

      const columnarResult: ColumnarResult = {
        query_id: current._streamQueryId ?? '',
        columns: current.columns,
        data: current.data,
        row_count: totalRows,
        affected_rows: null,
        execution_time_ms: executionTimeMs,
        warnings: current._streamWarnings,
        result_type: current._streamResultType ?? 'Select',
      };

      return {
        results: {
          ...s.results,
          [tabId]: {
            ...current,
            isExecuting: false,
            isStreaming: false,
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
        },
      };
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

  clearResult: (tabId) => {
    set((s) => {
      const { [tabId]: _, ...rest } = s.results;
      return { results: rest };
    });
  },

  clearAll: () => {
    set({ results: {} });
  },
}));
