import { invoke } from '@tauri-apps/api/core';
import type {
  ConnectionConfig, SavedConnection, QueryResult,
  DatabaseInfo, SchemaInfo, TableInfo, TableStructure, TableRef,
  QueryHistoryEntry,
} from './types';

export const ipc = {
  connect: (config: ConnectionConfig, password?: string) =>
    invoke<string>('connect', { config, password }),

  disconnect: (connectionId: string) =>
    invoke<void>('disconnect', { connectionId }),

  testConnection: (config: ConnectionConfig, password?: string) =>
    invoke<string>('test_connection', { config, password }),

  listSavedConnections: () =>
    invoke<SavedConnection[]>('list_saved_connections'),

  deleteSavedConnection: (id: string) =>
    invoke<void>('delete_saved_connection', { id }),

  executeQuery: (connectionId: string, sql: string) =>
    invoke<QueryResult>('execute_query', { connectionId, sql }),

  cancelQuery: (connectionId: string, queryId: string) =>
    invoke<void>('cancel_query', { connectionId, queryId }),

  getQueryHistory: (connectionId: string, limit?: number) =>
    invoke<QueryHistoryEntry[]>('get_query_history', { connectionId, limit }),

  executeBatch: (connectionId: string, statements: string[]) =>
    invoke<Array<{ Ok?: QueryResult; Err?: string }>>('execute_batch', {
      connectionId,
      statements,
    }),

  listDatabases: (connectionId: string) =>
    invoke<DatabaseInfo[]>('list_databases', { connectionId }),

  listSchemas: (connectionId: string, database: string) =>
    invoke<SchemaInfo[]>('list_schemas', { connectionId, database }),

  listTables: (connectionId: string, database: string, schema?: string) =>
    invoke<TableInfo[]>('list_tables', { connectionId, database, schema }),

  getTableStructure: (connectionId: string, tableRef: TableRef) =>
    invoke<TableStructure>('get_table_structure', { connectionId, tableRef }),
};
