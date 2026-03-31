use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;

use purrql_core::error::Result;
use purrql_core::models::connection::ConnectionConfig;
use purrql_core::models::connection::DatabaseType;
use purrql_core::ports::connection::DatabaseConnection;
use purrql_core::ports::dialect::QueryDialect;
use purrql_core::ports::schema::SchemaInspector;

#[async_trait]
pub trait DatabaseDriverFactory: Send + Sync {
    async fn create_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>>;

    fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector>;

    fn dialect(&self) -> Arc<dyn QueryDialect>;
}

pub struct DriverRegistry {
    factories: HashMap<DatabaseType, Arc<dyn DatabaseDriverFactory>>,
}

impl Default for DriverRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl DriverRegistry {
    pub fn new() -> Self {
        let mut factories: HashMap<DatabaseType, Arc<dyn DatabaseDriverFactory>> = HashMap::new();

        #[cfg(feature = "mysql")]
        factories.insert(DatabaseType::Mysql, Arc::new(MySqlDriverFactoryAdapter));

        #[cfg(feature = "postgres")]
        factories.insert(DatabaseType::Postgres, Arc::new(PostgresDriverFactoryAdapter));

        #[cfg(feature = "sqlite")]
        factories.insert(DatabaseType::Sqlite, Arc::new(SqliteDriverFactoryAdapter));

        Self { factories }
    }

    pub fn get_factory(&self, db_type: &DatabaseType) -> Option<Arc<dyn DatabaseDriverFactory>> {
        self.factories.get(db_type).cloned()
    }
}

#[cfg(feature = "mysql")]
struct MySqlDriverFactoryAdapter;

#[cfg(feature = "mysql")]
#[async_trait]
impl DatabaseDriverFactory for MySqlDriverFactoryAdapter {
    async fn create_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>> {
        purrql_mysql::MySqlDriverFactory
            .create_connection(config, password)
            .await
    }

    fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        purrql_mysql::MySqlDriverFactory.create_schema_inspector(conn)
    }

    fn dialect(&self) -> Arc<dyn QueryDialect> {
        purrql_mysql::MySqlDriverFactory.dialect()
    }
}

#[cfg(feature = "postgres")]
struct PostgresDriverFactoryAdapter;

#[cfg(feature = "postgres")]
#[async_trait]
impl DatabaseDriverFactory for PostgresDriverFactoryAdapter {
    async fn create_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>> {
        purrql_postgres::PostgresDriverFactory
            .create_connection(config, password)
            .await
    }

    fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        purrql_postgres::PostgresDriverFactory.create_schema_inspector(conn)
    }

    fn dialect(&self) -> Arc<dyn QueryDialect> {
        purrql_postgres::PostgresDriverFactory.dialect()
    }
}

#[cfg(feature = "sqlite")]
struct SqliteDriverFactoryAdapter;

#[cfg(feature = "sqlite")]
#[async_trait]
impl DatabaseDriverFactory for SqliteDriverFactoryAdapter {
    async fn create_connection(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Arc<dyn DatabaseConnection>> {
        purrql_sqlite::SqliteDriverFactory
            .create_connection(config, password)
            .await
    }

    fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        purrql_sqlite::SqliteDriverFactory.create_schema_inspector(conn)
    }

    fn dialect(&self) -> Arc<dyn QueryDialect> {
        purrql_sqlite::SqliteDriverFactory.dialect()
    }
}
