use async_trait::async_trait;
use uuid::Uuid;

use crate::error::Result;
use crate::models::connection::SavedConnection;
use crate::models::query::QueryHistoryEntry;

#[async_trait]
pub trait ConnectionRepository: Send + Sync {
    async fn list_all(&self) -> Result<Vec<SavedConnection>>;
    async fn get_by_id(&self, id: &Uuid) -> Result<Option<SavedConnection>>;
    async fn save(&self, connection: &SavedConnection) -> Result<()>;
    async fn delete(&self, id: &Uuid) -> Result<()>;
    async fn update_last_used(&self, id: &Uuid) -> Result<()>;
}

#[async_trait]
pub trait QueryRepository: Send + Sync {
    async fn add_to_history(&self, entry: &QueryHistoryEntry) -> Result<()>;
    async fn get_history(&self, connection_id: &Uuid, limit: u32) -> Result<Vec<QueryHistoryEntry>>;
    async fn clear_history(&self, connection_id: &Uuid) -> Result<()>;
    async fn search_history(&self, connection_id: &Uuid, query: &str, limit: u32) -> Result<Vec<QueryHistoryEntry>>;
}
