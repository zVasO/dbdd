use async_trait::async_trait;
use uuid::Uuid;

use dataforge_core::error::{DataForgeError, Result};
use dataforge_core::models::query::{CellValue, ColumnMeta, QueryResult, ResultType, Row};
use dataforge_core::ports::connection::DatabaseConnection;

pub struct MySqlConnection {
    pool: mysql_async::Pool,
}

impl MySqlConnection {
    pub async fn new(
        config: &dataforge_core::models::connection::ConnectionConfig,
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
            .pool_opts(pool_opts);

        let pool = mysql_async::Pool::new(opts);

        Ok(Self { pool })
    }
}

#[async_trait]
impl DatabaseConnection for MySqlConnection {
    async fn execute(&self, sql: &str) -> Result<QueryResult> {
        use mysql_async::prelude::*;

        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))?;

        let result: Vec<mysql_async::Row> = conn
            .query(sql)
            .await
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;

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
        for row in &result {
            let mut cells: Vec<CellValue> = Vec::with_capacity(col_count);
            for i in 0..row.len() {
                cells.push(crate::type_mapping::mysql_value_to_cell(row, i));
            }
            rows.push(Row { cells });
        }

        let row_count = rows.len() as u64;

        Ok(QueryResult {
            query_id: Uuid::new_v4(),
            columns,
            rows,
            total_rows: Some(row_count),
            affected_rows: None,
            execution_time_ms: 0,
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

        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))?;

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
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;

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
        for row in &result {
            let mut cells: Vec<CellValue> = Vec::with_capacity(col_count);
            for i in 0..row.len() {
                cells.push(crate::type_mapping::mysql_value_to_cell(row, i));
            }
            rows.push(Row { cells });
        }

        let row_count = rows.len() as u64;

        Ok(QueryResult {
            query_id: Uuid::new_v4(),
            columns,
            rows,
            total_rows: Some(row_count),
            affected_rows: None,
            execution_time_ms: 0,
            warnings: vec![],
            result_type: ResultType::Select,
        })
    }

    async fn cancel_query(&self, _query_id: &Uuid) -> Result<()> {
        Err(DataForgeError::NotSupported(
            "Query cancellation not yet implemented".to_string(),
        ))
    }

    async fn ping(&self) -> Result<()> {
        use mysql_async::prelude::*;
        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))?;
        conn.ping()
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))
    }

    async fn server_version(&self) -> Result<String> {
        use mysql_async::prelude::*;
        let mut conn = self
            .pool
            .get_conn()
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))?;
        let row: Option<mysql_async::Row> = conn
            .query_first("SELECT VERSION()")
            .await
            .map_err(|e| DataForgeError::QueryExecution(e.to_string()))?;
        match row {
            Some(r) => {
                let version: String = mysql_async::from_row(r);
                Ok(version)
            }
            None => Ok("Unknown".to_string()),
        }
    }

    async fn close(&self) -> Result<()> {
        self.pool
            .clone()
            .disconnect()
            .await
            .map_err(|e| DataForgeError::Connection(e.to_string()))
    }
}
