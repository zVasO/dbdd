use async_trait::async_trait;
use uuid::Uuid;

use crate::error::Result;
use crate::models::query::{CellValue, ColumnMeta, QueryResult, Row};

#[async_trait]
pub trait DatabaseConnection: Send + Sync {
    async fn execute(&self, sql: &str) -> Result<QueryResult>;
    async fn execute_with_params(&self, sql: &str, params: &[CellValue]) -> Result<QueryResult>;
    async fn cancel_query(&self, query_id: &Uuid) -> Result<()>;
    async fn ping(&self) -> Result<()>;
    async fn server_version(&self) -> Result<String>;
    async fn close(&self) -> Result<()>;

    /// Stream query results in chunks via an mpsc channel.
    /// Returns column metadata and a receiver of row chunks.
    /// Default implementation falls back to execute() and post-hoc chunking.
    async fn execute_stream(
        &self,
        sql: &str,
        chunk_size: usize,
    ) -> Result<(Vec<ColumnMeta>, tokio::sync::mpsc::Receiver<Result<Vec<Row>>>)> {
        let result = self.execute(sql).await?;
        let (tx, rx) = tokio::sync::mpsc::channel(4);
        let columns = result.columns;
        let chunk_sz = chunk_size.max(1);
        tokio::spawn(async move {
            for chunk in result.rows.chunks(chunk_sz) {
                if tx.send(Ok(chunk.to_vec())).await.is_err() {
                    break;
                }
            }
        });
        Ok((columns, rx))
    }
}
