pub mod connection;
pub mod dialect;
pub mod schema_inspector;
pub mod type_mapping;

use std::sync::Arc;

use spool_core::error::Result;
use spool_core::models::connection::ConnectionConfig;
use spool_core::ports::connection::DatabaseConnection;
use spool_core::ports::dialect::QueryDialect;
use spool_core::ports::schema::SchemaInspector;

pub struct SqliteDriverFactory;

impl SqliteDriverFactory {
    pub async fn create_connection(
        &self,
        _config: &ConnectionConfig,
        _password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>> {
        Ok(Arc::new(connection::SqliteConnection))
    }

    pub fn create_schema_inspector(
        &self,
        _conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        Arc::new(schema_inspector::SqliteSchemaInspector)
    }

    pub fn dialect(&self) -> Arc<dyn QueryDialect> {
        Arc::new(dialect::SqliteDialect)
    }
}
