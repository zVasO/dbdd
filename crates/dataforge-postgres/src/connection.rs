use async_trait::async_trait;
use uuid::Uuid;

use dataforge_core::error::{DataForgeError, Result};
use dataforge_core::models::connection::ConnectionConfig;
use dataforge_core::models::query::{CellValue, ColumnMeta, QueryResult, ResultType, Row};
use dataforge_core::ports::connection::DatabaseConnection;
use sqlx::postgres::{PgPoolOptions, PgRow};
use sqlx::{Column, PgPool, Row as SqlxRow, TypeInfo};

pub struct PostgresConnection {
    pool: PgPool,
}

impl PostgresConnection {
    pub async fn new(config: &ConnectionConfig, password: Option<&str>) -> Result<Self> {
        let url = build_connection_url(config, password);
        let pool = PgPoolOptions::new()
            .max_connections(config.pool_size.unwrap_or(20))
            .acquire_timeout(std::time::Duration::from_secs(10))
            .connect(&url)
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))?;

        Ok(Self { pool })
    }
}

fn url_encode(s: &str) -> String {
    let mut encoded = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' | '~' => encoded.push(ch),
            _ => {
                for b in ch.to_string().as_bytes() {
                    encoded.push_str(&format!("%{:02X}", b));
                }
            }
        }
    }
    encoded
}

fn build_connection_url(config: &ConnectionConfig, password: Option<&str>) -> String {
    let user = url_encode(&config.username);
    let pass = url_encode(password.unwrap_or(""));
    let host = &config.host;
    let port = config.port;
    let db = config.database.as_deref().unwrap_or("postgres");

    let sslmode = match config.ssl_mode {
        dataforge_core::models::connection::SslMode::Disable => "disable",
        dataforge_core::models::connection::SslMode::Prefer => "prefer",
        dataforge_core::models::connection::SslMode::Require => "require",
        dataforge_core::models::connection::SslMode::VerifyCa => "verify-ca",
        dataforge_core::models::connection::SslMode::VerifyFull => "verify-full",
    };

    format!(
        "postgres://{}:{}@{}:{}/{}?sslmode={}",
        user, pass, host, port, db, sslmode
    )
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

fn pg_typed_cell(row: &PgRow, index: usize, pg_type: &str) -> CellValue {
    match pg_type {
        "BOOL" => match row.try_get::<Option<bool>, _>(index) {
            Ok(Some(b)) => CellValue::Boolean(b),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "INT2" => match row.try_get::<Option<i16>, _>(index) {
            Ok(Some(n)) => CellValue::Integer(n as i64),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "INT4" => match row.try_get::<Option<i32>, _>(index) {
            Ok(Some(n)) => CellValue::Integer(n as i64),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "INT8" => match row.try_get::<Option<i64>, _>(index) {
            Ok(Some(n)) => CellValue::Integer(n),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "FLOAT4" => match row.try_get::<Option<f32>, _>(index) {
            Ok(Some(n)) => CellValue::Float(n as f64),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "FLOAT8" => match row.try_get::<Option<f64>, _>(index) {
            Ok(Some(n)) => CellValue::Float(n),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "NUMERIC" => match row.try_get::<Option<String>, _>(index) {
            Ok(Some(s)) => {
                if let Ok(n) = s.parse::<i64>() {
                    CellValue::Integer(n)
                } else if let Ok(n) = s.parse::<f64>() {
                    CellValue::Float(n)
                } else {
                    CellValue::Text(s)
                }
            }
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "TEXT" | "VARCHAR" | "CHAR" | "BPCHAR" | "NAME" => {
            match row.try_get::<Option<String>, _>(index) {
                Ok(Some(s)) => CellValue::Text(s),
                Ok(None) => CellValue::Null,
                Err(_) => CellValue::Null,
            }
        }
        "BYTEA" => match row.try_get::<Option<Vec<u8>>, _>(index) {
            Ok(Some(b)) => CellValue::Bytes {
                size: b.len() as u64,
                preview: hex_preview(&b, 32),
            },
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "TIMESTAMP" => match row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
            Ok(Some(dt)) => CellValue::DateTime(dt.format("%Y-%m-%d %H:%M:%S").to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "TIMESTAMPTZ" => match row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
            Ok(Some(dt)) => {
                CellValue::DateTime(dt.format("%Y-%m-%d %H:%M:%S%z").to_string())
            }
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "DATE" => match row.try_get::<Option<chrono::NaiveDate>, _>(index) {
            Ok(Some(d)) => CellValue::DateTime(d.format("%Y-%m-%d").to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "TIME" | "TIMETZ" => match row.try_get::<Option<chrono::NaiveTime>, _>(index) {
            Ok(Some(t)) => CellValue::Time(t.format("%H:%M:%S").to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "UUID" => match row.try_get::<Option<uuid::Uuid>, _>(index) {
            Ok(Some(u)) => CellValue::Text(u.to_string()),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        "JSON" | "JSONB" => match row.try_get::<Option<serde_json::Value>, _>(index) {
            Ok(Some(j)) => CellValue::Json(j),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
        _ => match row.try_get::<Option<String>, _>(index) {
            Ok(Some(s)) => CellValue::Text(s),
            Ok(None) => CellValue::Null,
            Err(_) => CellValue::Null,
        },
    }
}

fn map_pg_column_meta(col: &sqlx::postgres::PgColumn) -> (dataforge_core::models::types::DataType, String) {
    let native = col.type_info().name().to_string();
    let mapped = crate::type_mapping::map_postgres_type(&native);
    (mapped, native)
}

fn convert_pg_row(row: &PgRow, col_types: &[String]) -> Row {
    let mut cells = Vec::with_capacity(col_types.len());
    for (i, ct) in col_types.iter().enumerate() {
        cells.push(pg_typed_cell(row, i, ct));
    }
    Row { cells }
}

fn extract_pg_result(rows: &[PgRow]) -> (Vec<ColumnMeta>, Vec<Row>) {
    let (columns, col_types): (Vec<ColumnMeta>, Vec<String>) =
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
            let types: Vec<String> = first_row
                .columns()
                .iter()
                .map(|c| c.type_info().name().to_string())
                .collect();
            (cols, types)
        } else {
            (vec![], vec![])
        };

    let mut result_rows: Vec<Row> = Vec::with_capacity(rows.len());
    for row in rows {
        let mut cells: Vec<CellValue> = Vec::with_capacity(col_types.len());
        for (i, ct) in col_types.iter().enumerate() {
            cells.push(pg_typed_cell(row, i, ct));
        }
        result_rows.push(Row { cells });
    }

    (columns, result_rows)
}

#[async_trait]
impl DatabaseConnection for PostgresConnection {
    async fn execute(&self, sql: &str) -> Result<QueryResult> {
        let start = std::time::Instant::now();

        let rows: Vec<PgRow> = sqlx::query(sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;

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

    async fn execute_with_params(
        &self,
        sql: &str,
        params: &[CellValue],
    ) -> Result<QueryResult> {
        let start = std::time::Instant::now();

        // Build the query with bound parameters
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
                CellValue::Array(_) => {
                    return Err(DataForgeError::NotSupported(
                        "Array parameters not yet supported".to_string(),
                    ));
                }
            };
        }

        let rows: Vec<PgRow> = query
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;

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

    async fn cancel_query(&self, _query_id: &Uuid) -> Result<()> {
        let row: Option<PgRow> = sqlx::query(
            "SELECT pid FROM pg_stat_activity \
             WHERE state = 'active' \
             AND pid != pg_backend_pid() \
             AND query NOT LIKE '%pg_stat_activity%' \
             LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;

        match row {
            Some(row) => {
                let pid: i32 = row
                    .try_get("pid")
                    .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;
                sqlx::query("SELECT pg_cancel_backend($1)")
                    .bind(pid)
                    .execute(&self.pool)
                    .await
                    .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;
                Ok(())
            }
            None => Ok(()),
        }
    }

    async fn ping(&self) -> Result<()> {
        sqlx::query("SELECT 1")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))?;
        Ok(())
    }

    async fn server_version(&self) -> Result<String> {
        let row: PgRow = sqlx::query("SELECT version()")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;
        let version: String = row
            .try_get(0)
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;
        Ok(version)
    }

    async fn execute_stream(
        &self,
        sql: &str,
        chunk_size: usize,
    ) -> Result<(Vec<ColumnMeta>, tokio::sync::mpsc::Receiver<Result<Vec<Row>>>)> {
        use futures::StreamExt;

        let pool = self.pool.clone();
        let sql = sql.to_string();
        let chunk_size = chunk_size.max(1);
        let (meta_tx, meta_rx) = tokio::sync::oneshot::channel();
        let (tx, rx) = tokio::sync::mpsc::channel(4);

        tokio::spawn(async move {
            let mut stream = sqlx::query(&sql).fetch(&pool);
            let mut col_types: Vec<String> = vec![];
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
                            col_types = row
                                .columns()
                                .iter()
                                .map(|c| c.type_info().name().to_string())
                                .collect();
                            let _ = sender.send(Ok(cols));
                        }
                        chunk.push(convert_pg_row(&row, &col_types));
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
                            let _ = sender
                                .send(Err(DataForgeError::QueryExecution(err_msg.clone())));
                        }
                        let _ = tx
                            .send(Err(DataForgeError::QueryExecution(err_msg)))
                            .await;
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
        });

        let columns = meta_rx
            .await
            .map_err(|_| DataForgeError::QueryExecution("Stream task failed".to_string()))??;

        Ok((columns, rx))
    }

    async fn close(&self) -> Result<()> {
        self.pool.close().await;
        Ok(())
    }
}
