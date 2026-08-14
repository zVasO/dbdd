use std::sync::Arc;

use dashmap::DashMap;
use tokio::sync::watch;
use uuid::Uuid;

use purrql_config::store::ConfigStore;
use purrql_engine::{
    connection_manager::ConnectionManager, driver_registry::DriverRegistry, event_bus::EventBus,
    schema_cache::SchemaCache,
};

use crate::commands::import::ImportFiles;

pub struct AppState {
    pub connection_manager: Arc<ConnectionManager>,
    pub config_store: Arc<ConfigStore>,
    pub schema_cache: Arc<SchemaCache>,
    pub event_bus: Arc<EventBus>,
    pub driver_registry: Arc<DriverRegistry>,
    pub stream_cancellers: Arc<DashMap<Uuid, watch::Sender<bool>>>,
    /// Files a CSV preview has handed out a token for. The path stays here
    /// rather than travelling to the frontend and back.
    pub import_files: Arc<ImportFiles>,
}
