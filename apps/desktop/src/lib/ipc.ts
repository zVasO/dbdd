import { invoke } from '@tauri-apps/api/core';
import type {
  ConnectionConfig, SavedConnection, QueryResult, ColumnarResult,
  DatabaseInfo, SchemaInfo, TableInfo, TableStructure, TableRef,
  QueryHistoryEntry,
} from './types';

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

  executeQueryStream: (connectionId: string, sql: string, chunkSize?: number) =>
    invoke<string>('execute_query_stream', { connectionId, sql, chunkSize }),

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
};
