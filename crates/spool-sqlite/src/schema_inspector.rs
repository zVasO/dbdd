use async_trait::async_trait;

use spool_core::error::{SpoolError, Result};
use spool_core::models::schema::*;
use spool_core::ports::schema::SchemaInspector;

pub struct SqliteSchemaInspector;

#[async_trait]
impl SchemaInspector for SqliteSchemaInspector {
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>> {
        Err(SpoolError::NotSupported("SQLite schema inspector not yet implemented".to_string()))
    }
    async fn list_schemas(&self, _database: &str) -> Result<Vec<SchemaInfo>> {
        Ok(vec![])
    }
    async fn list_tables(&self, _database: &str, _schema: Option<&str>) -> Result<Vec<TableInfo>> {
        Err(SpoolError::NotSupported("SQLite schema inspector not yet implemented".to_string()))
    }
    async fn get_table_structure(&self, _table: &TableRef) -> Result<TableStructure> {
        Err(SpoolError::NotSupported("SQLite schema inspector not yet implemented".to_string()))
    }
    async fn list_all_columns(&self, _database: &str) -> Result<Vec<ColumnRef>> {
        Err(SpoolError::NotSupported("SQLite schema inspector not yet implemented".to_string()))
    }
}
