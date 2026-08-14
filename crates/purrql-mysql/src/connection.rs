use async_trait::async_trait;
use uuid::Uuid;

use purrql_core::error::{PurrqlError, Result};
use purrql_core::models::connection::SslMode;
use purrql_core::models::query::{CellValue, ColumnMeta, QueryResult, ResultType, Row};
use purrql_core::ports::connection::DatabaseConnection;

/// Map our SslMode to mysql_async TLS options.
/// Note: mysql_async has no opportunistic ("prefer") TLS, so Disable and Prefer
/// both connect in plaintext (Prefer stays non-fatal against non-TLS servers).
/// Require/VerifyCa/VerifyFull set SslOpts, which makes the handshake fail —
/// rather than silently downgrade — when the server has no TLS.
fn ssl_opts_from(mode: &SslMode) -> Option<mysql_async::SslOpts> {
    match mode {
        SslMode::Disable | SslMode::Prefer => None,
        SslMode::Require => Some(
            mysql_async::SslOpts::default()
                .with_danger_accept_invalid_certs(true)
                .with_danger_skip_domain_validation(true),
        ),
        SslMode::VerifyCa => {
            Some(mysql_async::SslOpts::default().with_danger_skip_domain_validation(true))
        }
        SslMode::VerifyFull => Some(mysql_async::SslOpts::default()),
    }
}

/// MySQL's ER_UNSUPPORTED_PS: the statement is outside the grammar the server
/// accepts over COM_STMT_PREPARE (USE, START TRANSACTION, ROLLBACK, SAVEPOINT,
/// LOCK TABLES, LOAD DATA, ...). Such a statement only runs over the text
/// protocol, so the binary path falls back to it on this code alone.
const ER_UNSUPPORTED_PS: u16 = 1295;

fn is_unsupported_ps(err: &mysql_async::Error) -> bool {
    matches!(err, mysql_async::Error::Server(e) if e.code == ER_UNSUPPORTED_PS)
}

pub struct MySqlConnection {
    pool: mysql_async::Pool,
}

impl MySqlConnection {
    pub async fn new(
        config: &purrql_core::models::connection::ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Self> {
        let max_conns = config.pool_size.unwrap_or(20);
        let min_conns = std::cmp::min(2, max_conns);
        let pool_opts = mysql_async::PoolOpts::default()
            .with_constraints(
                mysql_async::PoolConstraints::new(min_conns as usize, max_conns as usize).unwrap(),
            );

        let opts = mysql_async::OptsBuilder::default()
            .ip_or_hostname(&config.host)
            .tcp_port(config.port)
            .user(Some(&config.username))
            .pass(password)
            .db_name(config.database.as_deref())
            .conn_ttl(std::time::Duration::from_secs(300))
            .wait_timeout(Some(10))
            .ssl_opts(ssl_opts_from(&config.ssl_mode))
            .pool_opts(pool_opts);

        let pool = mysql_async::Pool::new(opts);

        Ok(Self { pool })
    }
}

fn extract_mysql_result(result: &[mysql_async::Row]) -> (Vec<ColumnMeta>, Vec<Row>) {
    let columns = if let Some(first_row) = result.first() {
        first_row
            .columns_ref()
            .iter()
            .map(|col| {
                let (data_type, native_type) = crate::type_mapping::map_column_meta(col);
                ColumnMeta {
                    name: col.name_str().to_string(),
                    data_type,
                    native_type,
                    nullable: true,
                    is_primary_key: false,
                    max_length: None,
                }
            })
            .collect()
    } else {
        vec![]
    };

    let col_count = result.first().map(|r| r.len()).unwrap_or(0);
    let mut rows: Vec<Row> = Vec::with_capacity(result.len());
    for row in result {
        let mut cells: Vec<CellValue> = Vec::with_capacity(col_count);
        for i in 0..row.len() {
            cells.push(crate::type_mapping::mysql_value_to_cell(row, i));
        }
        rows.push(Row { cells });
    }

    (columns, rows)
}

#[async_trait]
impl DatabaseConnection for MySqlConnection {
    async fn execute(&self, sql: &str) -> Result<QueryResult> {
        use mysql_async::prelude::*;

        let start = std::time::Instant::now();

        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))?;

        let result: Vec<mysql_async::Row> = match conn.prep(sql).await {
            Ok(stmt) => conn.exec(stmt, ()).await,
            Err(e) if is_unsupported_ps(&e) => conn.query(sql).await,
            Err(e) => Err(e),
        }
        .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;

        // Read from the OK packet that terminated the statement just run, so
        // it must be taken before `conn` is reused or returned to the pool.
        // Zero for a SELECT, which MySQL reports no affected count for.
        let affected_rows = conn.affected_rows();

        let (columns, rows) = extract_mysql_result(&result);
        let row_count = rows.len() as u64;

        Ok(QueryResult {
            query_id: Uuid::new_v4(),
            columns,
            rows,
            total_rows: Some(row_count),
            affected_rows: Some(affected_rows),
            execution_time_ms: start.elapsed().as_millis() as u64,
            warnings: vec![],
            result_type: ResultType::Select,
        })
    }

    async fn execute_with_params(
        &self,
        sql: &str,
        params: &[CellValue],
    ) -> Result<QueryResult> {
        use mysql_async::prelude::*;

        let start = std::time::Instant::now();

        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))?;

        let mysql_params: Vec<mysql_async::Value> = params
            .iter()
            .map(|p| match p {
                CellValue::Null => mysql_async::Value::NULL,
                CellValue::Integer(n) => mysql_async::Value::Int(*n),
                CellValue::Float(n) => mysql_async::Value::Double(*n),
                CellValue::Boolean(b) => mysql_async::Value::Int(if *b { 1 } else { 0 }),
                CellValue::Text(s) => mysql_async::Value::Bytes(s.as_bytes().to_vec()),
                CellValue::DateTime(s) | CellValue::Date(s) | CellValue::Time(s) => {
                    mysql_async::Value::Bytes(s.as_bytes().to_vec())
                }
                CellValue::Uuid(s) => mysql_async::Value::Bytes(s.as_bytes().to_vec()),
                CellValue::Json(v) => {
                    mysql_async::Value::Bytes(serde_json::to_string(v).unwrap_or_default().into_bytes())
                }
                CellValue::Bytes { preview, .. } => {
                    mysql_async::Value::Bytes(preview.as_bytes().to_vec())
                }
                CellValue::Array(items) => {
                    mysql_async::Value::Bytes(serde_json::to_string(items).unwrap_or_default().into_bytes())
                }
            })
            .collect();

        let result: Vec<mysql_async::Row> = conn
            .exec(sql, mysql_async::Params::Positional(mysql_params))
            .await
            .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;

        let (columns, rows) = extract_mysql_result(&result);
        let row_count = rows.len() as u64;

        Ok(QueryResult {
            query_id: Uuid::new_v4(),
            columns,
            rows,
            total_rows: Some(row_count),
            affected_rows: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
            warnings: vec![],
            result_type: ResultType::Select,
        })
    }

    async fn cancel_query(&self, _query_id: &Uuid) -> Result<()> {
        Err(PurrqlError::NotSupported(
            "Query cancellation not yet implemented".to_string(),
        ))
    }

    async fn ping(&self) -> Result<()> {
        use mysql_async::prelude::*;
        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))?;
        conn.ping()
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))
    }

    async fn server_version(&self) -> Result<String> {
        use mysql_async::prelude::*;
        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))?;
        let row: Option<mysql_async::Row> = conn
            .query_first("SELECT VERSION()")
            .await
            .map_err(|e| PurrqlError::QueryExecution(e.to_string()))?;
        match row {
            Some(r) => {
                let version: String = mysql_async::from_row(r);
                Ok(version)
            }
            None => Ok("Unknown".to_string()),
        }
    }

    async fn execute_stream(
        &self,
        sql: &str,
        chunk_size: usize,
    ) -> Result<(Vec<ColumnMeta>, tokio::sync::mpsc::Receiver<Result<Vec<Row>>>)> {
        use mysql_async::prelude::*;

        let pool = self.pool.clone();
        let sql = sql.to_string();
        let chunk_size = chunk_size.max(1);
        let (meta_tx, meta_rx) = tokio::sync::oneshot::channel();
        let (tx, rx) = tokio::sync::mpsc::channel(4);

        tokio::spawn(async move {
            // Acquire a dedicated connection for streaming
            let mut conn = match pool.get_conn().await {
                Ok(c) => c,
                Err(e) => {
                    let _ = meta_tx.send(Err(PurrqlError::Connection(e.to_string())));
                    return;
                }
            };

            // Preparing as its own step is what keeps the text fallback
            // reachable here: a result set borrows the connection, so the
            // protocol has to be settled before one exists.
            match conn.prep(sql.as_str()).await {
                Ok(stmt) => match conn.exec_iter(stmt, ()).await {
                    Ok(r) => stream_result_set(r, chunk_size, meta_tx, tx).await,
                    Err(e) => {
                        let _ = meta_tx.send(Err(PurrqlError::QueryExecution(e.to_string())));
                    }
                },
                Err(e) if is_unsupported_ps(&e) => match conn.query_iter(sql.as_str()).await {
                    Ok(r) => stream_result_set(r, chunk_size, meta_tx, tx).await,
                    Err(e) => {
                        let _ = meta_tx.send(Err(PurrqlError::QueryExecution(e.to_string())));
                    }
                },
                Err(e) => {
                    let _ = meta_tx.send(Err(PurrqlError::QueryExecution(e.to_string())));
                }
            }
        });

        let columns = meta_rx
            .await
            .map_err(|_| PurrqlError::QueryExecution("Stream task failed".to_string()))??;

        Ok((columns, rx))
    }

    async fn close(&self) -> Result<()> {
        self.pool
            .clone()
            .disconnect()
            .await
            .map_err(|e| PurrqlError::Connection(e.to_string()))
    }
}

/// Publish the result set's column metadata, then pump its rows into `tx` in
/// batches of `chunk_size`. Generic over the wire protocol so the binary and
/// text paths share one implementation.
async fn stream_result_set<P>(
    query_result: mysql_async::QueryResult<'_, 'static, P>,
    chunk_size: usize,
    meta_tx: tokio::sync::oneshot::Sender<Result<Vec<ColumnMeta>>>,
    tx: tokio::sync::mpsc::Sender<Result<Vec<Row>>>,
) where
    P: mysql_async::prelude::Protocol + Unpin,
{
    use futures::StreamExt;

    // Extract column metadata from the result set before consuming rows
    let columns_ref = query_result.columns().map(|arc| arc.to_vec());
    let col_meta: Vec<ColumnMeta> = match &columns_ref {
        Some(cols) => cols
            .iter()
            .map(|col| {
                let (data_type, native_type) = crate::type_mapping::map_column_meta(col);
                ColumnMeta {
                    name: col.name_str().to_string(),
                    data_type,
                    native_type,
                    nullable: true,
                    is_primary_key: false,
                    max_length: None,
                }
            })
            .collect(),
        None => vec![],
    };

    let col_count = col_meta.len();

    // Send column metadata back to the caller
    if meta_tx.send(Ok(col_meta)).is_err() {
        // Receiver dropped; drain the result set to return the connection
        let _ = query_result.stream_and_drop::<mysql_async::Row>().await;
        return;
    }

    // Stream rows using stream_and_drop for real cursor-based iteration
    let mut stream = match query_result.stream_and_drop::<mysql_async::Row>().await {
        Ok(Some(s)) => s,
        Ok(None) => {
            // No result set (e.g. DDL statement) — nothing to stream
            return;
        }
        Err(e) => {
            let _ = tx
                .send(Err(PurrqlError::QueryExecution(e.to_string())))
                .await;
            return;
        }
    };

    let mut chunk: Vec<Row> = Vec::with_capacity(chunk_size);

    while let Some(result) = stream.next().await {
        match result {
            Ok(row) => {
                let mut cells: Vec<CellValue> = Vec::with_capacity(col_count);
                for i in 0..row.len() {
                    cells.push(crate::type_mapping::mysql_value_to_cell(&row, i));
                }
                chunk.push(Row { cells });

                if chunk.len() >= chunk_size {
                    let full = std::mem::replace(&mut chunk, Vec::with_capacity(chunk_size));
                    if tx.send(Ok(full)).await.is_err() {
                        break;
                    }
                }
            }
            Err(e) => {
                let _ = tx
                    .send(Err(PurrqlError::QueryExecution(e.to_string())))
                    .await;
                return;
            }
        }
    }

    // Flush any remaining rows in the last partial chunk
    if !chunk.is_empty() {
        let _ = tx.send(Ok(chunk)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mysql_async::{Error, ServerError};

    fn server_error(code: u16) -> Error {
        Error::Server(ServerError {
            code,
            message: "This command is not supported in the prepared statement protocol yet"
                .to_string(),
            state: "HY000".to_string(),
        })
    }

    #[test]
    fn classifies_er_unsupported_ps() {
        assert!(is_unsupported_ps(&server_error(1295)));
    }

    #[test]
    fn leaves_other_server_errors_to_the_caller() {
        // 1064 (syntax error) and 1146 (no such table) are real failures: a
        // text-protocol retry would only repeat them.
        assert!(!is_unsupported_ps(&server_error(1064)));
        assert!(!is_unsupported_ps(&server_error(1146)));
    }

    #[test]
    fn non_server_errors_are_not_unsupported_ps() {
        let io = Error::Io(mysql_async::IoError::Io(std::io::Error::new(
            std::io::ErrorKind::BrokenPipe,
            "connection reset",
        )));
        assert!(!is_unsupported_ps(&io));
    }
}
