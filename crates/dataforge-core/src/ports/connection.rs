use async_trait::async_trait;
use uuid::Uuid;

use crate::error::Result;
use crate::models::query::{CellValue, QueryResult};

#[async_trait]
pub trait DatabaseConnection: Send + Sync {
    async fn execute(&self, sql: &str) -> Result<QueryResult>;
    async fn execute_with_params(&self, sql: &str, params: &[CellValue]) -> Result<QueryResult>;
    async fn cancel_query(&self, query_id: &Uuid) -> Result<()>;
    async fn ping(&self) -> Result<()>;
    async fn server_version(&self) -> Result<String>;
    async fn close(&self) -> Result<()>;
}
