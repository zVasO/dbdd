use async_trait::async_trait;
use uuid::Uuid;

use spool_core::error::{SpoolError, Result};
use spool_core::models::query::{CellValue, QueryResult};
use spool_core::ports::connection::DatabaseConnection;

pub struct SqliteConnection;

#[async_trait]
impl DatabaseConnection for SqliteConnection {
    async fn execute(&self, _sql: &str) -> Result<QueryResult> {
        Err(SpoolError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn execute_with_params(&self, _sql: &str, _params: &[CellValue]) -> Result<QueryResult> {
        Err(SpoolError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn cancel_query(&self, _query_id: &Uuid) -> Result<()> {
        Err(SpoolError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn ping(&self) -> Result<()> {
        Err(SpoolError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn server_version(&self) -> Result<String> {
        Err(SpoolError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn close(&self) -> Result<()> {
        Ok(())
    }
}
