use async_trait::async_trait;
use uuid::Uuid;

use purrql_core::error::{PurrqlError, Result};
use purrql_core::models::query::{CellValue, QueryResult};
use purrql_core::ports::connection::DatabaseConnection;

pub struct SqliteConnection;

#[async_trait]
impl DatabaseConnection for SqliteConnection {
    async fn execute(&self, _sql: &str) -> Result<QueryResult> {
        Err(PurrqlError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn execute_with_params(&self, _sql: &str, _params: &[CellValue]) -> Result<QueryResult> {
        Err(PurrqlError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn cancel_query(&self, _query_id: &Uuid) -> Result<()> {
        Err(PurrqlError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn ping(&self) -> Result<()> {
        Err(PurrqlError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn server_version(&self) -> Result<String> {
        Err(PurrqlError::NotSupported("SQLite driver not yet implemented".to_string()))
    }
    async fn close(&self) -> Result<()> {
        Ok(())
    }
}
