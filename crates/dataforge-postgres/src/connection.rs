use async_trait::async_trait;
use uuid::Uuid;

use dataforge_core::error::{DataForgeError, Result};
use dataforge_core::models::query::{CellValue, QueryResult};
use dataforge_core::ports::connection::DatabaseConnection;

pub struct PostgresConnection;

#[async_trait]
impl DatabaseConnection for PostgresConnection {
    async fn execute(&self, _sql: &str) -> Result<QueryResult> {
        Err(DataForgeError::NotSupported("PostgreSQL driver not yet implemented".to_string()))
    }
    async fn execute_with_params(&self, _sql: &str, _params: &[CellValue]) -> Result<QueryResult> {
        Err(DataForgeError::NotSupported("PostgreSQL driver not yet implemented".to_string()))
    }
    async fn cancel_query(&self, _query_id: &Uuid) -> Result<()> {
        Err(DataForgeError::NotSupported("PostgreSQL driver not yet implemented".to_string()))
    }
    async fn ping(&self) -> Result<()> {
        Err(DataForgeError::NotSupported("PostgreSQL driver not yet implemented".to_string()))
    }
    async fn server_version(&self) -> Result<String> {
        Err(DataForgeError::NotSupported("PostgreSQL driver not yet implemented".to_string()))
    }
    async fn close(&self) -> Result<()> {
        Ok(())
    }
}
