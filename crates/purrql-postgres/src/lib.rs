pub mod connection;
pub mod dialect;
pub mod schema_inspector;
pub mod type_mapping;

use std::sync::Arc;

use purrql_core::error::Result;
use purrql_core::models::connection::ConnectionConfig;
use purrql_core::ports::connection::DatabaseConnection;
use purrql_core::ports::dialect::QueryDialect;
use purrql_core::ports::schema::SchemaInspector;

pub struct PostgresDriverFactory;

impl PostgresDriverFactory {
    pub async fn create_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>> {
        Ok(Arc::new(connection::PostgresConnection::new(config, password).await?))
    }

    pub fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        Arc::new(schema_inspector::PostgresSchemaInspector::new(conn))
    }

    pub fn dialect(&self) -> Arc<dyn QueryDialect> {
        Arc::new(dialect::PostgresDialect)
    }
}
