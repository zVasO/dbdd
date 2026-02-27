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
        let opts = mysql_async::OptsBuilder::default()
            .ip_or_hostname(&config.host)
            .tcp_port(config.port)
            .user(Some(&config.username))
            .pass(password)
            .db_name(config.database.as_deref());

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
                .map(|col| ColumnMeta {
                    name: col.name_str().to_string(),
                    data_type: crate::type_mapping::map_mysql_type(
                        &format!("{:?}", col.column_type()),
                    ),
                    native_type: format!("{:?}", col.column_type()),
                    nullable: true,
                    is_primary_key: false,
                    max_length: None,
                })
                .collect()
        } else {
            vec![]
        };

        let rows: Vec<Row> = result
            .iter()
            .map(|row| {
                let cells: Vec<CellValue> = (0..row.len())
                    .map(|i| crate::type_mapping::mysql_value_to_cell(row, i))
                    .collect();
                Row { cells }
            })
            .collect();

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
        _sql: &str,
        _params: &[CellValue],
    ) -> Result<QueryResult> {
        Err(DataForgeError::NotSupported(
            "Parameterized queries not yet implemented".to_string(),
        ))
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
