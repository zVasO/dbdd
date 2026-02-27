pub mod connection;
pub mod dialect;
pub mod schema_inspector;
pub mod type_mapping;

use std::sync::Arc;

use dataforge_core::error::Result;
use dataforge_core::models::connection::ConnectionConfig;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::dialect::QueryDialect;
use dataforge_core::ports::schema::SchemaInspector;

pub struct MySqlDriverFactory;

impl MySqlDriverFactory {
    pub async fn create_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>> {
        Ok(Arc::new(connection::MySqlConnection::new(config, password).await?))
    }

    pub fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        Arc::new(schema_inspector::MySqlSchemaInspector::new(conn))
    }

    pub fn dialect(&self) -> Arc<dyn QueryDialect> {
        Arc::new(dialect::MySqlDialect)
    }
}
