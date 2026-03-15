// === IPC ERROR ===

export interface IpcError {
  code: string;
  message: string;
}

// === CONNECTION ===

export type DatabaseType = 'mysql' | 'sqlite' | 'postgres' | 'mongodb';

export type SslMode = 'disable' | 'prefer' | 'require' | 'verify_ca' | 'verify_full';

export interface SshTunnelConfig {
  host: string;
  port: number;
  username: string;
  auth_method: SshAuthMethod;
}

export type SshAuthMethod =
  | { type: 'Password' }
  | { type: 'PrivateKey'; key_path: string }
  | { type: 'Agent' };

export interface ConnectionConfig {
  id: string;
  name: string;
  db_type: DatabaseType;
  host: string;
  port: number;
  username: string;
  database: string | null;
  ssl_mode: SslMode;
  ssh_tunnel: SshTunnelConfig | null;
  color: string | null;
  environment?: 'local' | 'development' | 'testing' | 'staging' | 'production' | null;
  pool_size: number | null;
  query_timeout_ms: number | null;
}

export interface SavedConnection {
  config: ConnectionConfig;
  created_at: string;
  last_used_at: string | null;
  sort_order: number;
}

// === QUERY ===

export type ResultType = 'Select' | 'Insert' | 'Update' | 'Delete' | 'DDL' | 'Other';

export interface QueryResult {
  query_id: string;
  columns: ColumnMeta[];
  rows: Row[];
  total_rows: number | null;
  affected_rows: number | null;
  execution_time_ms: number;
  warnings: string[];
  result_type: ResultType;
}

export interface ColumnMeta {
  name: string;
  data_type: string | Record<string, unknown>;
  native_type: string;
  nullable: boolean;
  is_primary_key: boolean;
  max_length: number | null;
}

export interface Row {
  cells: CellValue[];
}

export type CellValue =
  | { type: 'Null' }
  | { type: 'Integer'; value: number }
  | { type: 'Float'; value: number }
  | { type: 'Boolean'; value: boolean }
  | { type: 'Text'; value: string }
  | { type: 'Json'; value: unknown }
  | { type: 'DateTime'; value: string }
  | { type: 'Date'; value: string }
  | { type: 'Time'; value: string }
  | { type: 'Uuid'; value: string }
  | { type: 'Bytes'; value: { size: number; preview: string } }
  | { type: 'Array'; value: CellValue[] };

// === COLUMNAR ===

export type ColumnData =
  | { kind: 'Integers'; values: (number | null)[] }
  | { kind: 'Floats'; values: (number | null)[] }
  | { kind: 'Booleans'; values: (boolean | null)[] }
  | { kind: 'Strings'; values: (string | null)[] }
  | { kind: 'Json'; values: (unknown | null)[] };

export interface ColumnarResult {
  query_id: string;
  columns: ColumnMeta[];
  data: ColumnData[];
  row_count: number;
  affected_rows: number | null;
  execution_time_ms: number;
  warnings: string[];
  result_type: ResultType;
}

export interface QueryHistoryEntry {
  id: string;
  connection_id: string;
  sql: string;
  executed_at: string;
  duration_ms: number;
  row_count: number | null;
  status: 'Success' | 'Error' | 'Cancelled';
  error_message: string | null;
}

// === SCHEMA ===

export interface TableRef {
  database: string | null;
  schema: string | null;
  table: string;
}

export interface DatabaseInfo {
  name: string;
  size_bytes: number | null;
  encoding: string | null;
}

export interface SchemaInfo {
  name: string;
  owner: string | null;
}

export interface TableInfo {
  name: string;
  table_type: 'Table' | 'View' | 'MaterializedView' | 'ForeignTable';
  row_count_estimate: number | null;
  size_bytes: number | null;
  comment: string | null;
}

export interface TableStructure {
  table_ref: TableRef;
  columns: ColumnInfo[];
  primary_key: PrimaryKeyInfo | null;
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
  constraints: ConstraintInfo[];
  comment: string | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  mapped_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  ordinal_position: number;
  comment: string | null;
}

export interface PrimaryKeyInfo {
  name: string | null;
  columns: string[];
}

export interface IndexInfo {
  name: string;
  columns: string[];
  is_unique: boolean;
  is_primary: boolean;
  index_type: string;
}

export interface ForeignKeyInfo {
  name: string;
  columns: string[];
  referenced_table: TableRef;
  referenced_columns: string[];
  on_update: string;
  on_delete: string;
}

export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  columns: string[];
  definition: string | null;
}

// === EVENTS ===

export type AppEvent =
  | { event_type: 'ConnectionEstablished'; payload: { connection_id: string } }
  | { event_type: 'ConnectionClosed'; payload: { connection_id: string } }
  | { event_type: 'ConnectionError'; payload: { connection_id: string; error: string } }
  | { event_type: 'QueryStarted'; payload: { query_id: string; sql: string } }
  | { event_type: 'QueryProgress'; payload: { query_id: string; rows_fetched: number; elapsed_ms: number } }
  | { event_type: 'QueryCompleted'; payload: { query_id: string; row_count: number; elapsed_ms: number } }
  | { event_type: 'QueryError'; payload: { query_id: string; error: string } }
  | { event_type: 'QueryCancelled'; payload: { query_id: string } };

// === STREAMING QUERY EVENTS ===
// Payloads for Tauri streaming events (matches Rust query.rs:229-301)
// Note: Rust emits query_id in the event name, not the payload.
// The listener helper injects query_id into these interfaces for convenience.

export interface StreamMeta {
  query_id: string;
  columns: ColumnMeta[];
  result_type: string;
  warnings: string[];
}

export interface StreamChunk {
  query_id: string;
  offset: number;
  data: ColumnData[];
}

export interface StreamDone {
  query_id: string;
  total_rows: number;
  execution_time_ms: number;
}

export interface StreamError {
  query_id: string;
  error: string;
}
