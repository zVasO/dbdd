use async_trait::async_trait;
use dashmap::DashMap;
use std::sync::Arc;
use uuid::Uuid;

use purrql_core::error::{PurrqlError, Result};
use purrql_core::models::connection::{ConnectionConfig, SslMode};
use purrql_core::models::query::{CellValue, ColumnMeta, QueryResult, ResultType, Row};
use purrql_core::ports::connection::DatabaseConnection;
use sqlx::pool::PoolConnection;
use sqlx::postgres::{PgConnectOptions, PgPoolOptions, PgRow, PgSslMode};
use sqlx::{Column, ConnectOptions, PgPool, Postgres, Row as SqlxRow, TypeInfo};

/// Backend pid of the Postgres session running each in-flight tracked query,
/// keyed by the query id the caller will later cancel with.
///
/// Cancellation has to name a specific backend, and one `PostgresConnection`
/// is shared by every tab pointed at that database. Without this map the only
/// way to pick a pid is to guess at an active one, which cancels whichever
/// query happens to be running — routinely the wrong tab's.
type QueryPids = DashMap<Uuid, i32>;

fn record_pid(pids: &QueryPids, query_id: &Uuid, pid: i32) {
    pids.insert(*query_id, pid);
}

fn lookup_pid(pids: &QueryPids, query_id: &Uuid) -> Option<i32> {
    pids.get(query_id).map(|entry| *entry)
}

fn forget_pid(pids: &QueryPids, query_id: &Uuid) {
    pids.remove(query_id);
}

/// Drops a query's pid registration when the query ends, by whichever route.
///
/// A guard rather than a cleanup call at the end of the happy path because a
/// cancelled query never reaches that line: the caller races the query
/// against a cancellation signal and drops the losing future mid-flight, so
/// only `Drop` runs. Without this the map would accumulate one dead entry per
/// cancelled query.
struct PidRegistration {
    pids: Arc<QueryPids>,
    query_id: Uuid,
}

impl PidRegistration {
    /// `None` for an untracked query, which registers no pid to clean up.
    fn new(pids: &Arc<QueryPids>, query_id: Option<&Uuid>) -> Option<Self> {
        query_id.map(|id| Self {
            pids: Arc::clone(pids),
            query_id: *id,
        })
    }
}

impl Drop for PidRegistration {
    fn drop(&mut self) {
        forget_pid(&self.pids, &self.query_id);
    }
}

pub struct PostgresConnection {
    pool: PgPool,
    query_pids: Arc<QueryPids>,
}

impl PostgresConnection {
    pub async fn new(config: &ConnectionConfig, password: Option<&str>) -> Result<Self> {
        let opts = build_connect_options(config, password);
        let pool = PgPoolOptions::new()
            .max_connections(config.pool_size.unwrap_or(20))
            .min_connections(2)
            .acquire_timeout(std::time::Duration::from_secs(10))
            .test_before_acquire(false)
            .connect_with(opts)
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))?;

        Ok(Self {
            pool,
            query_pids: Arc::new(QueryPids::new()),
        })
    }

    /// Take a connection out of the pool and, when `query_id` is set, record
    /// the pid of the backend serving it.
    ///
    /// The statement must then run on the returned connection: `pg_backend_pid()`
    /// is per-session, so a pid read here says nothing about a statement sent
    /// through the pool separately. Retries call this again and overwrite the
    /// entry, so the recorded pid always belongs to the connection the query
    /// is actually running on.
    async fn acquire_tracked(
        &self,
        query_id: Option<&Uuid>,
    ) -> std::result::Result<PoolConnection<Postgres>, sqlx::Error> {
        let mut conn = self.pool.acquire().await?;
        if let Some(id) = query_id {
            let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
                .fetch_one(&mut *conn)
                .await?;
            record_pid(&self.query_pids, id, pid);
        }
        Ok(conn)
    }

    async fn run_query(&self, sql: &str, query_id: Option<&Uuid>) -> Result<QueryResult> {
        let start = std::time::Instant::now();
        let _registration = PidRegistration::new(&self.query_pids, query_id);

        let outcome = with_retry(is_retryable_statement(sql), move || async move {
            let mut conn = self.acquire_tracked(query_id).await?;
            sqlx::query(sql).fetch_all(&mut *conn).await
        })
        .await;

        let rows: Vec<PgRow> = outcome.map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;
        let (columns, result_rows) = extract_pg_result(&rows);
        let row_count = result_rows.len() as u64;

        Ok(QueryResult {
            query_id: query_id.copied().unwrap_or_else(Uuid::new_v4),
            columns,
            rows: result_rows,
            total_rows: Some(row_count),
            affected_rows: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            warnings: vec![],
            result_type: ResultType::Select,
        })
    }

    async fn run_stream(
        &self,
        sql: &str,
        chunk_size: usize,
        query_id: Option<&Uuid>,
    ) -> Result<(Vec<ColumnMeta>, tokio::sync::mpsc::Receiver<Result<Vec<Row>>>)> {
        use futures::StreamExt;

        // Acquired up front rather than inside the task so the stream runs on
        // the same session whose pid was recorded, and so an acquire failure
        // surfaces to the caller instead of only reaching the channel.
        let mut conn = self
            .acquire_tracked(query_id)
            .await
            .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;

        let registration = PidRegistration::new(&self.query_pids, query_id);
        let sql = sql.to_string();
        let chunk_size = chunk_size.max(1);
        let (meta_tx, meta_rx) = tokio::sync::oneshot::channel();
        let (tx, rx) = tokio::sync::mpsc::channel(4);

        tokio::spawn(async move {
            // Moved into the task so the pid stays registered for as long as
            // the stream is actually running on this connection, and is
            // cleared however the task ends.
            let _registration = registration;
            {
                let mut stream = sqlx::query(&sql).fetch(&mut *conn);
                let mut col_decoders: Vec<PgDecoder> = vec![];
                let mut meta_tx = Some(meta_tx);
                let mut chunk: Vec<Row> = Vec::with_capacity(chunk_size);

                while let Some(result) = stream.next().await {
                    match result {
                        Ok(row) => {
                            if let Some(sender) = meta_tx.take() {
                                let cols: Vec<ColumnMeta> = row
                                    .columns()
                                    .iter()
                                    .map(|col| {
                                        let (data_type, native_type) = map_pg_column_meta(col);
                                        ColumnMeta {
                                            name: col.name().to_string(),
                                            data_type,
                                            native_type,
                                            nullable: true,
                                            is_primary_key: false,
                                            max_length: None,
                                        }
                                    })
                                    .collect();
                                col_decoders = row
                                    .columns()
                                    .iter()
                                    .map(|c| decoder_for_type(c.type_info().name()))
                                    .collect();
                                let _ = sender.send(Ok(cols));
                            }
                            chunk.push(convert_pg_row(&row, &col_decoders));
                            if chunk.len() >= chunk_size {
                                let full =
                                    std::mem::replace(&mut chunk, Vec::with_capacity(chunk_size));
                                if tx.send(Ok(full)).await.is_err() {
                                    break;
                                }
                            }
                        }
                        Err(e) => {
                            let err_msg = e.to_string();
                            if let Some(sender) = meta_tx.take() {
                                let _ =
                                    sender.send(Err(PurrqlError::QueryExecution(err_msg.clone())));
                            }
                            let _ = tx.send(Err(PurrqlError::QueryExecution(err_msg))).await;
                            return;
                        }
                    }
                }

                if let Some(sender) = meta_tx.take() {
                    let _ = sender.send(Ok(vec![]));
                }
                if !chunk.is_empty() {
                    let _ = tx.send(Ok(chunk)).await;
                }
            }
        });

        let columns = meta_rx
            .await
            .map_err(|_| PurrqlError::QueryExecution("Stream task failed".to_string()))??;

        Ok((columns, rx))
    }
}

/// Whether `e` indicates the pooled connection was already closed rather
/// than a query-level failure, so it's safe to retry once on a fresh
/// connection. Needed because `test_before_acquire(false)` can hand out a
/// connection the server (or an idle timeout) has since dropped.
fn is_closed_connection_error(e: &sqlx::Error) -> bool {
    match e {
        sqlx::Error::Io(io_err) => matches!(
            io_err.kind(),
            std::io::ErrorKind::BrokenPipe
                | std::io::ErrorKind::ConnectionReset
                | std::io::ErrorKind::ConnectionAborted
                | std::io::ErrorKind::NotConnected
                | std::io::ErrorKind::UnexpectedEof
        ),
        sqlx::Error::PoolClosed => true,
        _ => false,
    }
}

/// Strip leading SQL comments (line and block) to find the first real keyword.
fn strip_leading_comments(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if s.starts_with("--") {
            s = s.find('\n').map_or("", |i| &s[i + 1..]).trim_start();
        } else if s.starts_with("/*") {
            s = s
                .get(2..)
                .and_then(|r| r.find("*/").map(|i| &r[i + 2..]))
                .unwrap_or("")
                .trim_start();
        } else {
            break;
        }
    }
    s
}

/// Whether `s` starts with `word` as a standalone keyword (not merely as a
/// prefix of a longer identifier).
fn starts_with_keyword(s: &str, word: &str) -> bool {
    s.get(..word.len())
        .is_some_and(|head| head.eq_ignore_ascii_case(word))
        && s[word.len()..]
            .chars()
            .next()
            .is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
}

/// Whether `sql` is read-only enough to safely retry after a
/// closed-connection error. A `sqlx::Error::Io` carries no phase
/// information: it looks identical whether the statement never reached the
/// server (safe to retry) or it already executed and only the response was
/// lost (retrying would silently re-execute it). Rather than guess, only
/// statements that are provably side-effect-free — `SELECT`, `SHOW`,
/// `EXPLAIN` — are retried. `WITH` is deliberately excluded even though most
/// CTEs are reads, because Postgres allows data-modifying CTEs
/// (`WITH x AS (INSERT ...) SELECT ...`) that this keyword check can't tell
/// apart from a plain read. A leading comment that can't be cheaply skipped
/// also disables retry. False negatives (an unnecessary lack of retry) are
/// acceptable; false positives (retrying a write) are not.
fn is_retryable_statement(sql: &str) -> bool {
    let trimmed = strip_leading_comments(sql);
    ["SELECT", "SHOW", "EXPLAIN"]
        .iter()
        .any(|kw| starts_with_keyword(trimmed, kw))
}

/// Run `f` once, retrying a single time if `retryable` is set and the first
/// attempt fails with a closed-connection error. Any other outcome
/// (including a second closed-connection error, or `retryable` being false)
/// is returned as-is.
async fn with_retry<F, Fut, T>(retryable: bool, mut f: F) -> std::result::Result<T, sqlx::Error>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = std::result::Result<T, sqlx::Error>>,
{
    match f().await {
        Err(e) if retryable && is_closed_connection_error(&e) => f().await,
        other => other,
    }
}

fn build_connect_options(config: &ConnectionConfig, password: Option<&str>) -> PgConnectOptions {
    let ssl_mode = match config.ssl_mode {
        SslMode::Disable => PgSslMode::Disable,
        SslMode::Prefer => PgSslMode::Prefer,
        SslMode::Require => PgSslMode::Require,
        SslMode::VerifyCa => PgSslMode::VerifyCa,
        SslMode::VerifyFull => PgSslMode::VerifyFull,
    };

    let mut opts = PgConnectOptions::new()
        .host(&config.host)
        .port(config.port)
        .username(&config.username)
        .ssl_mode(ssl_mode)
        .database(config.database.as_deref().unwrap_or("postgres"));

    if let Some(pw) = password {
        opts = opts.password(pw);
    }

    // Disable sqlx query logging to avoid leaking SQL in trace logs
    opts = opts.disable_statement_logging();

    opts
}

fn hex_preview(bytes: &[u8], max_bytes: usize) -> String {
    use std::fmt::Write;
    let take = bytes.len().min(max_bytes);
    let mut s = String::with_capacity(2 + take * 2);
    s.push_str("\\x");
    for b in bytes.iter().take(take) {
        write!(s, "{:02x}", b).unwrap();
    }
    s
}

/// Which decode path a column takes, resolved once per column by
/// [`decoder_for_type`] instead of re-matching the Postgres type name for
/// every cell in that column.
#[derive(Clone, Copy, PartialEq, Debug)]
enum PgDecoder {
    Bool,
    Int2,
    Int4,
    Int8,
    Float4,
    Float8,
    Numeric,
    Text,
    Json,
    Uuid,
    Timestamp,
    TimestampTz,
    Date,
    Time,
    Bytea,
    Other,
}

/// The one place the Postgres type-name string is matched. Called once per
/// column, not once per cell.
fn decoder_for_type(pg_type: &str) -> PgDecoder {
    match pg_type {
        "BOOL" => PgDecoder::Bool,
        "INT2" => PgDecoder::Int2,
        "INT4" => PgDecoder::Int4,
        "INT8" => PgDecoder::Int8,
        "FLOAT4" => PgDecoder::Float4,
        "FLOAT8" => PgDecoder::Float8,
        "NUMERIC" => PgDecoder::Numeric,
        "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" => PgDecoder::Text,
        "BYTEA" => PgDecoder::Bytea,
        "TIMESTAMP" => PgDecoder::Timestamp,
        "TIMESTAMPTZ" => PgDecoder::TimestampTz,
        "DATE" => PgDecoder::Date,
        "TIME" | "TIMETZ" => PgDecoder::Time,
        "UUID" => PgDecoder::Uuid,
        "JSON" | "JSONB" => PgDecoder::Json,
        _ => PgDecoder::Other,
    }
}

fn decode_cell(row: &PgRow, index: usize, decoder: PgDecoder) -> CellValue {
    match decoder {
        PgDecoder::Bool => match row.try_get::<Option<bool>, _>(index) {
            Ok(Some(b)) => CellValue::Boolean(b),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Int2 => match row.try_get::<Option<i16>, _>(index) {
            Ok(Some(n)) => CellValue::Integer(n as i64),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Int4 => match row.try_get::<Option<i32>, _>(index) {
            Ok(Some(n)) => CellValue::Integer(n as i64),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Int8 => match row.try_get::<Option<i64>, _>(index) {
            Ok(Some(n)) => CellValue::Integer(n),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Float4 => match row.try_get::<Option<f32>, _>(index) {
            Ok(Some(n)) => CellValue::Float(n as f64),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Float8 => match row.try_get::<Option<f64>, _>(index) {
            Ok(Some(n)) => CellValue::Float(n),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Numeric => match row.try_get::<Option<sqlx::types::BigDecimal>, _>(index) {
            Ok(Some(n)) => CellValue::Text(n.to_string()),
            Ok(None) => CellValue::Null,
            Err(e) => {
                tracing::warn!(column = index, error = %e, "failed to decode NUMERIC column");
                CellValue::Null
            }
        },
        PgDecoder::Text => match row.try_get::<Option<String>, _>(index) {
            Ok(Some(s)) => CellValue::Text(s),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Bytea => match row.try_get::<Option<Vec<u8>>, _>(index) {
            Ok(Some(b)) => CellValue::Bytes {
                size: b.len() as u64,
                preview: hex_preview(&b, 32),
            },
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Timestamp => match row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
            Ok(Some(dt)) => CellValue::DateTime(dt.format("%Y-%m-%d %H:%M:%S").to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::TimestampTz => {
            match row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
                Ok(Some(dt)) => CellValue::DateTime(dt.format("%Y-%m-%d %H:%M:%S%z").to_string()),
                Ok(None) => CellValue::Null,
                Err(_) => CellValue::Null,
            }
        }
        PgDecoder::Date => match row.try_get::<Option<chrono::NaiveDate>, _>(index) {
            Ok(Some(d)) => CellValue::DateTime(d.format("%Y-%m-%d").to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Time => match row.try_get::<Option<chrono::NaiveTime>, _>(index) {
            Ok(Some(t)) => CellValue::Time(t.format("%H:%M:%S").to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Uuid => match row.try_get::<Option<uuid::Uuid>, _>(index) {
            Ok(Some(u)) => CellValue::Text(u.to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Json => match row.try_get::<Option<serde_json::Value>, _>(index) {
            Ok(Some(j)) => CellValue::Json(j),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        PgDecoder::Other => match row.try_get::<Option<String>, _>(index) {
            Ok(Some(s)) => CellValue::Text(s),
            Ok(None) => CellValue::Null,
            Err(e) => {
                tracing::warn!(decoder = ?decoder, error = %e, "unhandled Postgres type, value dropped");
                CellValue::Null
            }
        },
    }
}

fn map_pg_column_meta(col: &sqlx::postgres::PgColumn) -> (purrql_core::models::types::DataType, String) {
    let native = col.type_info().name().to_string();
    let mapped = crate::type_mapping::map_postgres_type(&native);
    (mapped, native)
}

fn convert_pg_row(row: &PgRow, col_decoders: &[PgDecoder]) -> Row {
    let mut cells = Vec::with_capacity(col_decoders.len());
    for (i, decoder) in col_decoders.iter().enumerate() {
        cells.push(decode_cell(row, i, *decoder));
    }
    Row { cells }
}

fn extract_pg_result(rows: &[PgRow]) -> (Vec<ColumnMeta>, Vec<Row>) {
    let (columns, col_decoders): (Vec<ColumnMeta>, Vec<PgDecoder>) =
        if let Some(first_row) = rows.first() {
            let cols: Vec<ColumnMeta> = first_row
                .columns()
                .iter()
                .map(|col| {
                    let (data_type, native_type) = map_pg_column_meta(col);
                    ColumnMeta {
                        name: col.name().to_string(),
                        data_type,
                        native_type,
                        nullable: true,
                        is_primary_key: false,
                        max_length: None,
                    }
                })
                .collect();
            let decoders: Vec<PgDecoder> = first_row
                .columns()
                .iter()
                .map(|c| decoder_for_type(c.type_info().name()))
                .collect();
            (cols, decoders)
        } else {
            (vec![], vec![])
        };

    let mut result_rows: Vec<Row> = Vec::with_capacity(rows.len());
    for row in rows {
        let mut cells: Vec<CellValue> = Vec::with_capacity(col_decoders.len());
        for (i, decoder) in col_decoders.iter().enumerate() {
            cells.push(decode_cell(row, i, *decoder));
        }
        result_rows.push(Row { cells });
    }

    (columns, result_rows)
}

#[async_trait]
impl DatabaseConnection for PostgresConnection {
    async fn execute(&self, sql: &str) -> Result<QueryResult> {
        self.run_query(sql, None).await
    }

    async fn execute_tracked(&self, sql: &str, query_id: &Uuid) -> Result<QueryResult> {
        self.run_query(sql, Some(query_id)).await
    }

    /// Deliberately untracked: every caller is a schema inspector, none of
    /// which runs under a user query id, so there is no id for `cancel_query`
    /// to name. Adding a tracked variant here would be unreachable code.
    async fn execute_with_params(
        &self,
        sql: &str,
        params: &[CellValue],
    ) -> Result<QueryResult> {
        let start = std::time::Instant::now();

        if params.iter().any(|p| matches!(p, CellValue::Array(_))) {
            return Err(PurrqlError::NotSupported(
                "Array parameters not yet supported".to_string(),
            ));
        }

        // Rebuilds the query from scratch on each attempt, since a bound
        // `Query` is consumed by `fetch_all` and can't be replayed as-is.
        let build_query = || {
            let mut query = sqlx::query(sql);
            for param in params {
                query = match param {
                    CellValue::Null => query.bind(None::<String>),
                    CellValue::Text(s) => query.bind(s.as_str()),
                    CellValue::Integer(n) => query.bind(*n),
                    CellValue::Float(n) => query.bind(*n),
                    CellValue::Boolean(b) => query.bind(*b),
                    CellValue::DateTime(s) | CellValue::Date(s) | CellValue::Time(s)
                    | CellValue::Uuid(s) => query.bind(s.as_str()),
                    CellValue::Json(v) => query.bind(v),
                    // For types that don't map cleanly, bind as text
                    CellValue::Bytes { preview, .. } => query.bind(preview.as_str()),
                    CellValue::Array(_) => unreachable!("checked above"),
                };
            }
            query
        };

        let rows: Vec<PgRow> = with_retry(is_retryable_statement(sql), || {
            build_query().fetch_all(&self.pool)
        })
        .await
        .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;

        let (columns, result_rows) = extract_pg_result(&rows);
        let row_count = result_rows.len() as u64;

        Ok(QueryResult {
            query_id: Uuid::new_v4(),
            columns,
            rows: result_rows,
            total_rows: Some(row_count),
            affected_rows: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            warnings: vec![],
            result_type: ResultType::Select,
        })
    }

    /// Cancel the backend running `query_id`, and only that one.
    ///
    /// Nothing recorded means there is nothing this driver may cancel: the
    /// query already finished, or it ran on a path that doesn't register a
    /// pid. Both are a no-op. Falling back to "cancel whichever backend looks
    /// busy" is what let closing one tab kill another tab's query.
    async fn cancel_query(&self, query_id: &Uuid) -> Result<()> {
        // Read the pid out before awaiting so no map guard is held across it.
        let pid = lookup_pid(&self.query_pids, query_id);
        let Some(pid) = pid else {
            return Ok(());
        };

        sqlx::query("SELECT pg_cancel_backend($1)")
            .bind(pid)
            .execute(&self.pool)
            .await
            .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;
        Ok(())
    }

    async fn ping(&self) -> Result<()> {
        sqlx::query("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))?;
        Ok(())
    }

    async fn server_version(&self) -> Result<String> {
        let row: PgRow = sqlx::query("SELECT version()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;
        let version: String = row
            .try_get(0)
            .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;
        Ok(version)
    }

    async fn execute_stream(
        &self,
        sql: &str,
        chunk_size: usize,
    ) -> Result<(Vec<ColumnMeta>, tokio::sync::mpsc::Receiver<Result<Vec<Row>>>)> {
        self.run_stream(sql, chunk_size, None).await
    }

    async fn execute_stream_tracked(
        &self,
        sql: &str,
        chunk_size: usize,
        query_id: &Uuid,
    ) -> Result<(Vec<ColumnMeta>, tokio::sync::mpsc::Receiver<Result<Vec<Row>>>)> {
        self.run_stream(sql, chunk_size, Some(query_id)).await
    }

    async fn close(&self) -> Result<()> {
        self.pool.close().await;
        // Nothing left to cancel once the pool is gone.
        self.query_pids.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decoder_for_type, forget_pid, is_closed_connection_error, is_retryable_statement,
        lookup_pid, record_pid, with_retry, PgDecoder, PidRegistration, QueryPids,
    };
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use uuid::Uuid;

    fn io_error(kind: std::io::ErrorKind) -> sqlx::Error {
        sqlx::Error::Io(std::io::Error::new(kind, "closed"))
    }

    #[test]
    fn records_and_looks_up_the_pid_of_a_tracked_query() {
        let pids = QueryPids::new();
        let query_id = Uuid::new_v4();

        record_pid(&pids, &query_id, 4242);

        assert_eq!(lookup_pid(&pids, &query_id), Some(4242));
    }

    #[test]
    fn an_unknown_query_id_has_no_pid_to_cancel() {
        let pids = QueryPids::new();
        // The lookup returning None is what makes cancel_query a no-op rather
        // than a guess at some other backend.
        assert_eq!(lookup_pid(&pids, &Uuid::new_v4()), None);
    }

    #[test]
    fn a_finished_query_leaves_no_pid_behind() {
        let pids = QueryPids::new();
        let query_id = Uuid::new_v4();

        record_pid(&pids, &query_id, 4242);
        forget_pid(&pids, &query_id);

        assert_eq!(lookup_pid(&pids, &query_id), None);
        assert!(pids.is_empty());
        // Cleanup runs on success and on error alike, so a second removal
        // (or one for a query that never registered) is harmless.
        forget_pid(&pids, &query_id);
        assert_eq!(lookup_pid(&pids, &query_id), None);
    }

    #[test]
    fn each_query_keeps_its_own_pid() {
        // Two tabs on one connection: cancelling either must not disturb the
        // other's recorded backend.
        let pids = QueryPids::new();
        let tab_a = Uuid::new_v4();
        let tab_b = Uuid::new_v4();

        record_pid(&pids, &tab_a, 111);
        record_pid(&pids, &tab_b, 222);
        forget_pid(&pids, &tab_a);

        assert_eq!(lookup_pid(&pids, &tab_a), None);
        assert_eq!(lookup_pid(&pids, &tab_b), Some(222));
    }

    #[test]
    fn dropping_the_registration_clears_the_pid_even_when_the_query_never_finishes() {
        // The cancellation path: the caller drops the in-flight query future,
        // so nothing after the await runs and only Drop can clean up.
        let pids = Arc::new(QueryPids::new());
        let query_id = Uuid::new_v4();

        {
            let _registration = PidRegistration::new(&pids, Some(&query_id));
            record_pid(&pids, &query_id, 4242);
            assert_eq!(lookup_pid(&pids, &query_id), Some(4242));
        }

        assert_eq!(lookup_pid(&pids, &query_id), None);
    }

    #[test]
    fn an_untracked_query_registers_nothing() {
        let pids = Arc::new(QueryPids::new());
        assert!(PidRegistration::new(&pids, None).is_none());
    }

    #[test]
    fn a_retry_repoints_the_query_at_the_connection_it_landed_on() {
        // A retry acquires a different pooled connection, so the recorded pid
        // must be replaced — cancelling the first, dead backend would leave
        // the query that's actually running untouched.
        let pids = QueryPids::new();
        let query_id = Uuid::new_v4();

        record_pid(&pids, &query_id, 111);
        record_pid(&pids, &query_id, 222);

        assert_eq!(lookup_pid(&pids, &query_id), Some(222));
        assert_eq!(pids.len(), 1);
    }

    #[test]
    fn treats_closed_socket_io_errors_as_retryable() {
        for kind in [
            std::io::ErrorKind::BrokenPipe,
            std::io::ErrorKind::ConnectionReset,
            std::io::ErrorKind::ConnectionAborted,
            std::io::ErrorKind::NotConnected,
            std::io::ErrorKind::UnexpectedEof,
        ] {
            assert!(
                is_closed_connection_error(&io_error(kind)),
                "{kind:?} should be treated as a closed connection"
            );
        }
    }

    #[test]
    fn treats_pool_closed_as_retryable() {
        assert!(is_closed_connection_error(&sqlx::Error::PoolClosed));
    }

    #[test]
    fn does_not_treat_query_errors_as_retryable() {
        assert!(!is_closed_connection_error(&sqlx::Error::RowNotFound));
        assert!(!is_closed_connection_error(&io_error(
            std::io::ErrorKind::TimedOut
        )));
    }

    #[test]
    fn treats_select_show_explain_as_retryable_statements() {
        assert!(is_retryable_statement("SELECT * FROM users"));
        assert!(is_retryable_statement("  select 1"));
        assert!(is_retryable_statement("SHOW TABLES"));
        assert!(is_retryable_statement("EXPLAIN SELECT * FROM users"));
        assert!(is_retryable_statement(
            "-- get the users\nSELECT * FROM users"
        ));
        assert!(is_retryable_statement(
            "/* block comment */ SELECT * FROM users"
        ));
    }

    #[test]
    fn does_not_treat_writes_or_ddl_as_retryable_statements() {
        assert!(!is_retryable_statement("INSERT INTO t VALUES (1)"));
        assert!(!is_retryable_statement("UPDATE t SET x = 1"));
        assert!(!is_retryable_statement("DELETE FROM t"));
        assert!(!is_retryable_statement("DROP TABLE t"));
        assert!(!is_retryable_statement("CREATE TABLE t (id INT)"));
    }

    #[test]
    fn does_not_treat_a_data_modifying_cte_as_retryable() {
        // Postgres allows WITH to wrap a write; a keyword check alone can't
        // tell this apart from a read-only CTE, so WITH is never retried.
        assert!(!is_retryable_statement(
            "WITH x AS (INSERT INTO t DEFAULT VALUES RETURNING id) SELECT * FROM x"
        ));
        assert!(!is_retryable_statement(
            "WITH x AS (SELECT 1) SELECT * FROM x"
        ));
    }

    #[test]
    fn does_not_treat_an_identifier_prefix_as_the_keyword() {
        assert!(!is_retryable_statement("SELECTFOO"));
        assert!(!is_retryable_statement("SHOWCASE"));
    }

    #[tokio::test]
    async fn retries_once_after_a_closed_connection_then_succeeds() {
        let attempts = AtomicU32::new(0);
        let result = with_retry(true, || {
            let attempt = attempts.fetch_add(1, Ordering::SeqCst);
            async move {
                if attempt == 0 {
                    Err(io_error(std::io::ErrorKind::BrokenPipe))
                } else {
                    Ok(42)
                }
            }
        })
        .await;

        assert_eq!(result.unwrap(), 42);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn does_not_retry_a_second_closed_connection_failure() {
        let attempts = AtomicU32::new(0);
        let result: Result<i32, sqlx::Error> = with_retry(true, || {
            attempts.fetch_add(1, Ordering::SeqCst);
            async move { Err(io_error(std::io::ErrorKind::BrokenPipe)) }
        })
        .await;

        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn does_not_retry_a_plain_query_error() {
        let attempts = AtomicU32::new(0);
        let result: Result<i32, sqlx::Error> = with_retry(true, || {
            attempts.fetch_add(1, Ordering::SeqCst);
            async move { Err(sqlx::Error::RowNotFound) }
        })
        .await;

        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    /// (a) A read-only statement's closed-connection error is retried once.
    #[tokio::test]
    async fn read_only_statement_is_retried_on_closed_connection() {
        let attempts = AtomicU32::new(0);
        let result = with_retry(is_retryable_statement("SELECT * FROM users"), || {
            let attempt = attempts.fetch_add(1, Ordering::SeqCst);
            async move {
                if attempt == 0 {
                    Err(io_error(std::io::ErrorKind::BrokenPipe))
                } else {
                    Ok(7)
                }
            }
        })
        .await;

        assert_eq!(result.unwrap(), 7);
        assert_eq!(attempts.load(Ordering::SeqCst), 2);
    }

    /// (b) INSERT/UPDATE never retry on a closed-connection error — the
    /// error surfaces from the single attempt instead of risking a
    /// duplicate write.
    #[tokio::test]
    async fn insert_and_update_are_not_retried_on_closed_connection() {
        for sql in ["INSERT INTO t VALUES (1)", "UPDATE t SET x = 1"] {
            let attempts = AtomicU32::new(0);
            let result: Result<i32, sqlx::Error> = with_retry(is_retryable_statement(sql), || {
                attempts.fetch_add(1, Ordering::SeqCst);
                async move { Err(io_error(std::io::ErrorKind::BrokenPipe)) }
            })
            .await;

            assert!(result.is_err(), "{sql} should surface the error");
            assert_eq!(
                attempts.load(Ordering::SeqCst),
                1,
                "{sql} should not be retried"
            );
        }
    }

    /// (c) A data-modifying CTE never retries either, even though it starts
    /// with WITH ... SELECT superficially.
    #[tokio::test]
    async fn data_modifying_cte_is_not_retried_on_closed_connection() {
        let sql = "WITH x AS (INSERT INTO t DEFAULT VALUES RETURNING id) SELECT * FROM x";
        let attempts = AtomicU32::new(0);
        let result: Result<i32, sqlx::Error> = with_retry(is_retryable_statement(sql), || {
            attempts.fetch_add(1, Ordering::SeqCst);
            async move { Err(io_error(std::io::ErrorKind::BrokenPipe)) }
        })
        .await;

        assert!(result.is_err());
        assert_eq!(attempts.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn maps_every_known_pg_type_name_to_its_decoder_and_falls_back_to_other() {
        let cases = [
            ("BOOL", PgDecoder::Bool),
            ("INT2", PgDecoder::Int2),
            ("INT4", PgDecoder::Int4),
            ("INT8", PgDecoder::Int8),
            ("FLOAT4", PgDecoder::Float4),
            ("FLOAT8", PgDecoder::Float8),
            ("NUMERIC", PgDecoder::Numeric),
            ("TEXT", PgDecoder::Text),
            ("VARCHAR", PgDecoder::Text),
            ("CHAR", PgDecoder::Text),
            ("BPCHAR", PgDecoder::Text),
            ("NAME", PgDecoder::Text),
            ("BYTEA", PgDecoder::Bytea),
            ("TIMESTAMP", PgDecoder::Timestamp),
            ("TIMESTAMPTZ", PgDecoder::TimestampTz),
            ("DATE", PgDecoder::Date),
            ("TIME", PgDecoder::Time),
            ("TIMETZ", PgDecoder::Time),
            ("UUID", PgDecoder::Uuid),
            ("JSON", PgDecoder::Json),
            ("JSONB", PgDecoder::Json),
            ("MONEY", PgDecoder::Other),
            ("INT4RANGE", PgDecoder::Other),
            ("", PgDecoder::Other),
        ];

        for (pg_type, expected) in cases {
            assert_eq!(
                decoder_for_type(pg_type),
                expected,
                "{pg_type} should map to {expected:?}"
            );
        }
    }
}
