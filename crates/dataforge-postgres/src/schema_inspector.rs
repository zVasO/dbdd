use async_trait::async_trait;

use dataforge_core::error::{DataForgeError, Result};
use dataforge_core::models::schema::*;
use dataforge_core::ports::schema::SchemaInspector;

pub struct PostgresSchemaInspector;

#[async_trait]
impl SchemaInspector for PostgresSchemaInspector {
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>> {
        Err(DataForgeError::NotSupported("PostgreSQL schema inspector not yet implemented".to_string()))
    }
    async fn list_schemas(&self, _database: &str) -> Result<Vec<SchemaInfo>> {
        Err(DataForgeError::NotSupported("PostgreSQL schema inspector not yet implemented".to_string()))
    }
    async fn list_tables(&self, _database: &str, _schema: Option<&str>) -> Result<Vec<TableInfo>> {
        Err(DataForgeError::NotSupported("PostgreSQL schema inspector not yet implemented".to_string()))
    }
    async fn get_table_structure(&self, _table: &TableRef) -> Result<TableStructure> {
        Err(DataForgeError::NotSupported("PostgreSQL schema inspector not yet implemented".to_string()))
    }
}
