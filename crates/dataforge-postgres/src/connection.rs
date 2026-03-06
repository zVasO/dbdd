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
            .max_connections(5)
            .connect(&url)
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))?;

        Ok(Self { pool })
    }
}

fn build_connection_url(config: &ConnectionConfig, password: Option<&str>) -> String {
    let user = &config.username;
    let pass = password.unwrap_or("");
    let host = &config.host;
    let port = config.port;
    let db = config.database.as_deref().unwrap_or("postgres");
    format!("postgres://{}:{}@{}:{}/{}", user, pass, host, port, db)
}

fn pg_value_to_cell(row: &PgRow, index: usize) -> CellValue {
    // Try each type in order; sqlx returns an error if the type doesn't match
    // so we cascade through the common types.

    // NULL check — use try_get with Option
    if let Ok(val) = row.try_get::<Option<bool>, _>(index) {
        return match val {
            Some(b) => CellValue::Boolean(b),
            None => CellValue::Null,
        };
    }

    if let Ok(val) = row.try_get::<Option<i16>, _>(index) {
        return match val {
            Some(n) => CellValue::Integer(n as i64),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<i32>, _>(index) {
        return match val {
            Some(n) => CellValue::Integer(n as i64),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<i64>, _>(index) {
        return match val {
            Some(n) => CellValue::Integer(n),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<f32>, _>(index) {
        return match val {
            Some(n) => CellValue::Float(n as f64),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<f64>, _>(index) {
        return match val {
            Some(n) => CellValue::Float(n),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<chrono::NaiveDateTime>, _>(index) {
        return match val {
            Some(dt) => CellValue::DateTime(dt.format("%Y-%m-%d %H:%M:%S").to_string()),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>(index) {
        return match val {
            Some(dt) => CellValue::DateTime(dt.format("%Y-%m-%d %H:%M:%S%z").to_string()),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<chrono::NaiveDate>, _>(index) {
        return match val {
            Some(d) => CellValue::DateTime(d.format("%Y-%m-%d").to_string()),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<chrono::NaiveTime>, _>(index) {
        return match val {
            Some(t) => CellValue::Time(t.format("%H:%M:%S").to_string()),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<serde_json::Value>, _>(index) {
        return match val {
            Some(j) => CellValue::Json(j),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<uuid::Uuid>, _>(index) {
        return match val {
            Some(u) => CellValue::Text(u.to_string()),
            None => CellValue::Null,
        };
    }
    if let Ok(val) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return match val {
            Some(b) => CellValue::Bytes {
                size: b.len() as u64,
                preview: format!("\\x{}", b.iter().take(32).map(|b| format!("{:02x}", b)).collect::<String>()),
            },
            None => CellValue::Null,
        };
    }
    // Fallback: try as string
    if let Ok(val) = row.try_get::<Option<String>, _>(index) {
        return match val {
            Some(s) => CellValue::Text(s),
            None => CellValue::Null,
        };
    }

    CellValue::Null
}

fn map_pg_column_meta(col: &sqlx::postgres::PgColumn) -> (dataforge_core::models::types::DataType, String) {
    let native = col.type_info().name().to_string();
    let mapped = crate::type_mapping::map_postgres_type(&native);
    (mapped, native)
}

#[async_trait]
impl DatabaseConnection for PostgresConnection {
    async fn execute(&self, sql: &str) -> Result<QueryResult> {
        let rows: Vec<PgRow> = sqlx::query(sql)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;

        let columns = if let Some(first_row) = rows.first() {
            first_row
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
                .collect()
        } else {
            vec![]
        };

        let result_rows: Vec<Row> = rows
            .iter()
            .map(|row| {
                let cells: Vec<CellValue> = (0..row.columns().len())
                    .map(|i| pg_value_to_cell(row, i))
                    .collect();
                Row { cells }
            })
            .collect();

        let row_count = result_rows.len() as u64;

        Ok(QueryResult {
            query_id: Uuid::new_v4(),
            columns,
            rows: result_rows,
            total_rows: Some(row_count),
            affected_rows: None,
            execution_time_ms: 0,
            warnings: vec![],
            result_type: ResultType::Select,
        })
    }

    async fn execute_with_params(
        &self,
        _sql: &str,
        _params: &[CellValue],
    ) -> Result<QueryResult> {
        Err(DataForgeError::NotSupported(
            "Parameterized queries not yet implemented for PostgreSQL".to_string(),
        ))
    }

    async fn cancel_query(&self, _query_id: &Uuid) -> Result<()> {
        Err(DataForgeError::NotSupported(
            "Query cancellation not yet implemented for PostgreSQL".to_string(),
        ))
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

    async fn close(&self) -> Result<()> {
        self.pool.close().await;
        Ok(())
    }
}
