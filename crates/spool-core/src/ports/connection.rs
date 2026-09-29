use async_trait::async_trait;
use uuid::Uuid;

use crate::error::Result;
use crate::models::columnar::ColumnarResult;
use crate::models::query::{CellValue, ColumnMeta, QueryResult, Row};

#[async_trait]
pub trait DatabaseConnection: Send + Sync {
    async fn execute(&self, sql: &str) -> Result<QueryResult>;
    async fn execute_with_params(&self, sql: &str, params: &[CellValue]) -> Result<QueryResult>;

    /// Execute `sql` on behalf of `query_id`, letting the driver associate the
    /// server-side session with that id so a later `cancel_query(query_id)`
    /// can target exactly this statement rather than guessing which of the
    /// connection's in-flight queries to stop.
    ///
    /// Drivers with no server-side cancellation ignore the id; the default
    /// implementation just runs `execute`, and `cancel_query` stays a no-op
    /// for them.
    async fn execute_tracked(&self, sql: &str, query_id: &Uuid) -> Result<QueryResult> {
        let _ = query_id;
        self.execute(sql).await
    }

    /// Execute `sql` under `query_id` and return its results already laid out
    /// by column, the shape the UI consumes.
    ///
    /// The default transposes `execute_tracked`'s rows, so a driver that
    /// can't do better keeps working unchanged. A driver that can decode
    /// straight into columns overrides this and skips the intermediate
    /// `Vec<Row>` and its per-cell `CellValue` entirely.
    ///
    /// Tracked only: every caller runs under a query id, so an untracked
    /// variant would be unreachable.
    async fn execute_columnar_tracked(&self, sql: &str, query_id: &Uuid) -> Result<ColumnarResult> {
        let result = self.execute_tracked(sql, query_id).await?;
        Ok(ColumnarResult::from_query_result_consuming(result))
    }

    /// Cancel the query previously started under `query_id`.
    ///
    /// A driver must only cancel work it recorded against this exact id.
    /// When nothing is recorded — the query already finished, or it ran on a
    /// path the driver can't track — this is a no-op, never a best-effort
    /// guess at some other in-flight query.
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

    /// Streaming counterpart of `execute_tracked`: same query-id association,
    /// so a stream can be cancelled server-side and not just dropped locally.
    async fn execute_stream_tracked(
        &self,
        sql: &str,
        chunk_size: usize,
        query_id: &Uuid,
    ) -> Result<(Vec<ColumnMeta>, tokio::sync::mpsc::Receiver<Result<Vec<Row>>>)> {
        let _ = query_id;
        self.execute_stream(sql, chunk_size).await
    }
}
