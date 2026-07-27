use async_trait::async_trait;

use crate::error::Result;
use crate::models::schema::*;

#[async_trait]
pub trait SchemaInspector: Send + Sync {
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>>;
    async fn list_schemas(&self, database: &str) -> Result<Vec<SchemaInfo>>;
    async fn list_tables(&self, database: &str, schema: Option<&str>) -> Result<Vec<TableInfo>>;
    async fn get_table_structure(&self, table: &TableRef) -> Result<TableStructure>;
    /// All columns of a database in one query — feeds the search index cheaply
    /// (name/table/type only), without per-table structure round-trips.
    async fn list_all_columns(&self, database: &str) -> Result<Vec<ColumnRef>>;
}
