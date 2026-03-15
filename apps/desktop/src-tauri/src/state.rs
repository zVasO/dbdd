use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::watch;
use uuid::Uuid;

use purrql_config::store::ConfigStore;
use purrql_engine::{
    connection_manager::ConnectionManager, driver_registry::DriverRegistry, event_bus::EventBus,
    schema_cache::SchemaCache,
};

pub struct AppState {
    pub connection_manager: Arc<ConnectionManager>,
    pub config_store: Arc<ConfigStore>,
    pub schema_cache: Arc<SchemaCache>,
    pub event_bus: Arc<EventBus>,
    pub driver_registry: Arc<DriverRegistry>,
    pub stream_cancellers: Arc<DashMap<Uuid, watch::Sender<bool>>>,
}
