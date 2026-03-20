import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ConnectionConfig, SavedConnection, QueryResult, ColumnarResult,
  DatabaseInfo, SchemaInfo, TableInfo, TableStructure, TableRef,
  QueryHistoryEntry, IpcError,
  StreamMeta, StreamChunk, StreamDone, StreamError,
} from './types';

/**
 * Extract a human-readable error message from a Tauri IPC error.
 * Handles structured IpcError { code, message } and plain strings/Error.
 */
export function extractErrorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as IpcError).message);
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

/** In-flight request deduplication map */
const inFlight = new Map<string, Promise<unknown>>();

/** Deduplicate concurrent calls with the same key */
function dedup<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = fn().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export const ipc = {
  connect: (config: ConnectionConfig, password?: string) =>
    invoke<string>('connect', { config, password }),

  disconnect: (connectionId: string) =>
    invoke<void>('disconnect', { connectionId }),

  testConnection: (config: ConnectionConfig, password?: string) =>
    invoke<string>('test_connection', { config, password }),

  listSavedConnections: () =>
    dedup('savedConnections', () =>
      invoke<SavedConnection[]>('list_saved_connections')
    ),

  deleteSavedConnection: (id: string) =>
    invoke<void>('delete_saved_connection', { id }),

  updateSavedConnection: (config: ConnectionConfig) =>
    invoke<void>('update_saved_connection', { config }),

  executeQuery: (connectionId: string, sql: string) =>
    invoke<QueryResult>('execute_query', { connectionId, sql }),

  executeQueryColumnar: (connectionId: string, sql: string) =>
    invoke<ColumnarResult>('execute_query_columnar', { connectionId, sql }),

  cancelQuery: (connectionId: string, queryId: string) =>
    invoke<void>('cancel_query', { connectionId, queryId }),

  getQueryHistory: (connectionId: string, limit?: number) =>
    dedup(`history:${connectionId}`, () =>
      invoke<QueryHistoryEntry[]>('get_query_history', { connectionId, limit })
    ),

  executeQueryStream: (connectionId: string, sql: string, chunkSize?: number, queryId?: string) =>
    invoke<string>('execute_query_stream', { connectionId, sql, chunkSize, queryId }),

  executeBatch: (connectionId: string, statements: string[]) =>
    invoke<Array<{ Ok?: QueryResult; Err?: string }>>('execute_batch', {
      connectionId,
      statements,
    }),

  listDatabases: (connectionId: string) =>
    dedup(`databases:${connectionId}`, () =>
      invoke<DatabaseInfo[]>('list_databases', { connectionId })
    ),

  listSchemas: (connectionId: string, database: string) =>
    dedup(`schemas:${connectionId}:${database}`, () =>
      invoke<SchemaInfo[]>('list_schemas', { connectionId, database })
    ),

  listTables: (connectionId: string, database: string, schema?: string) =>
    dedup(`tables:${connectionId}:${database}:${schema ?? ''}`, () =>
      invoke<TableInfo[]>('list_tables', { connectionId, database, schema })
    ),

  getTableStructure: (connectionId: string, tableRef: TableRef) =>
    dedup(`structure:${connectionId}:${tableRef.database}:${tableRef.schema ?? ''}:${tableRef.table}`, () =>
      invoke<TableStructure>('get_table_structure', { connectionId, tableRef })
    ),

  pingConnection: (connectionId: string) =>
    invoke<void>('ping_connection', { connectionId }),

  openSqlFile: () =>
    invoke<[string, string] | null>('open_sql_file'),

  saveSqlFile: (content: string, suggestedName?: string) =>
    invoke<string | null>('save_sql_file', { content, suggestedName }),

  importCsvFile: () =>
    invoke<[string, string] | null>('import_csv_file'),

  listenToStream: async (queryId: string, callbacks: {
    onMeta: (meta: StreamMeta) => void;
    onChunk: (chunk: StreamChunk) => void;
    onDone: (done: StreamDone) => void;
    onError: (error: StreamError) => void;
  }): Promise<() => void> => {
    const unlisteners = await Promise.all([
      listen<Omit<StreamMeta, 'query_id'>>(
        `query_meta_${queryId}`,
        (e) => callbacks.onMeta({ ...e.payload, query_id: queryId }),
      ),
      listen<Omit<StreamChunk, 'query_id'>>(
        `query_chunk_${queryId}`,
        (e) => callbacks.onChunk({ ...e.payload, query_id: queryId }),
      ),
      listen<Omit<StreamDone, 'query_id'>>(
        `query_done_${queryId}`,
        (e) => callbacks.onDone({ ...e.payload, query_id: queryId }),
      ),
      listen<Omit<StreamError, 'query_id'>>(
        `query_error_${queryId}`,
        (e) => callbacks.onError({ ...e.payload, query_id: queryId }),
      ),
    ]);
    return () => unlisteners.forEach((fn) => fn());
  },
};
