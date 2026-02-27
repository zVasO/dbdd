use std::sync::Arc;

use dashmap::DashMap;
use uuid::Uuid;

use dataforge_core::error::{DataForgeError, Result};
use dataforge_core::models::connection::ConnectionConfig;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::dialect::QueryDialect;
use dataforge_core::ports::schema::SchemaInspector;

use crate::driver_registry::DriverRegistry;

pub struct ActiveConnection {
    pub connection: Arc<dyn DatabaseConnection>,
    pub schema_inspector: Arc<dyn SchemaInspector>,
    pub dialect: Arc<dyn QueryDialect>,
    pub config_id: Uuid,
}

pub struct ConnectionManager {
    connections: DashMap<Uuid, ActiveConnection>,
    pub driver_registry: Arc<DriverRegistry>,
}

impl ConnectionManager {
    pub fn new(driver_registry: Arc<DriverRegistry>) -> Self {
        Self {
            connections: DashMap::new(),
            driver_registry,
        }
    }

    pub async fn connect(
        &self,
        config: &ConnectionConfig,
        password: Option<&str>,
    ) -> Result<Uuid> {
        let factory = self
            .driver_registry
            .get_factory(&config.db_type)
            .ok_or_else(|| {
                DataForgeError::DriverNotFound(config.db_type.display_name().to_string())
            })?;

        let conn = factory.create_connection(config, password).await?;
        conn.ping().await?;

        let connection_id = Uuid::new_v4();
        let active = ActiveConnection {
            connection: conn.clone(),
            schema_inspector: factory.create_schema_inspector(conn),
            dialect: factory.dialect(),
            config_id: config.id,
        };

        self.connections.insert(connection_id, active);
        Ok(connection_id)
    }

    pub async fn disconnect(&self, connection_id: &Uuid) -> Result<()> {
        if let Some((_, active)) = self.connections.remove(connection_id) {
            active.connection.close().await?;
        }
        Ok(())
    }

    pub fn get(
        &self,
        connection_id: &Uuid,
    ) -> Option<dashmap::mapref::one::Ref<'_, Uuid, ActiveConnection>> {
        self.connections.get(connection_id)
    }
}
