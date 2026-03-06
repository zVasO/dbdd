use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;

use dataforge_core::error::Result;
use dataforge_core::models::connection::ConnectionConfig;
use dataforge_core::models::connection::DatabaseType;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::dialect::QueryDialect;
use dataforge_core::ports::schema::SchemaInspector;

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
        dataforge_mysql::MySqlDriverFactory
            .create_connection(config, password)
            .await
    }

    fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        dataforge_mysql::MySqlDriverFactory.create_schema_inspector(conn)
    }

    fn dialect(&self) -> Arc<dyn QueryDialect> {
        dataforge_mysql::MySqlDriverFactory.dialect()
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
        dataforge_postgres::PostgresDriverFactory
            .create_connection(config, password)
            .await
    }

    fn create_schema_inspector(
        &self,
        conn: Arc<dyn DatabaseConnection>,
    ) -> Arc<dyn SchemaInspector> {
        dataforge_postgres::PostgresDriverFactory.create_schema_inspector(conn)
    }

    fn dialect(&self) -> Arc<dyn QueryDialect> {
        dataforge_postgres::PostgresDriverFactory.dialect()
    }
}
