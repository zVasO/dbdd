use async_trait::async_trait;

use purrql_core::error::{PurrqlError, Result};
use purrql_core::models::schema::*;
use purrql_core::ports::schema::SchemaInspector;

pub struct SqliteSchemaInspector;

#[async_trait]
impl SchemaInspector for SqliteSchemaInspector {
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>> {
        Err(PurrqlError::NotSupported("SQLite schema inspector not yet implemented".to_string()))
    }
    async fn list_schemas(&self, _database: &str) -> Result<Vec<SchemaInfo>> {
        Ok(vec![])
    }
    async fn list_tables(&self, _database: &str, _schema: Option<&str>) -> Result<Vec<TableInfo>> {
        Err(PurrqlError::NotSupported("SQLite schema inspector not yet implemented".to_string()))
    }
    async fn get_table_structure(&self, _table: &TableRef) -> Result<TableStructure> {
        Err(PurrqlError::NotSupported("SQLite schema inspector not yet implemented".to_string()))
    }
}
