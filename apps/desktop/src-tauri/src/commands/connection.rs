use std::sync::Arc;

use tauri::State;
use uuid::Uuid;

use purrql_core::error::IpcError;
use purrql_core::models::connection::{ConnectionConfig, SavedConnection};
use purrql_engine::event_bus::AppEvent;

use crate::state::AppState;

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<Uuid, IpcError> {
    // Resolve the effective password before connecting (retrieve stored one if not provided).
    let effective_password = if password.is_some() {
        password.clone()
    } else {
        state
            .config_store
            .get_password(&config.id)
            .await
            .map_err(IpcError::from)?
    };

    // Connect first — only persist config and password on success.
    let connection_id = state
        .connection_manager
        .connect(&config, effective_password.as_deref())
        .await
        .map_err(IpcError::from)?;

    // Connection succeeded — now persist config and password.
    state
        .config_store
        .save_connection(&config)
        .await
        .map_err(IpcError::from)?;

    if let Some(ref pw) = password {
        state
            .config_store
            .store_password(&config.id, pw)
            .await
            .map_err(IpcError::from)?;
    }

    state
        .event_bus
        .emit(AppEvent::ConnectionEstablished { connection_id });

    Ok(connection_id)
}

#[tauri::command]
pub async fn disconnect(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<(), IpcError> {
    state
        .connection_manager
        .disconnect(&connection_id)
        .await
        .map_err(IpcError::from)?;
    state.schema_cache.invalidate_connection(&connection_id);
    state
        .event_bus
        .emit(AppEvent::ConnectionClosed { connection_id });
    Ok(())
}

#[tauri::command]
pub async fn test_connection(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<String, IpcError> {
    let factory = state
        .driver_registry
        .get_factory(&config.db_type)
        .ok_or(IpcError::from("Driver not found"))?;
    let conn = factory
        .create_connection(&config, password.as_deref())
        .await
        .map_err(IpcError::from)?;
    let result = async {
        conn.ping().await.map_err(IpcError::from)?;
        conn.server_version().await.map_err(IpcError::from)
    }
    .await;
    let _ = conn.close().await;
    result
}

#[tauri::command]
pub async fn list_saved_connections(
    state: State<'_, AppState>,
) -> Result<Vec<SavedConnection>, IpcError> {
    state
        .config_store
        .list_connections()
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn delete_saved_connection(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<(), IpcError> {
    state
        .config_store
        .delete_connection(&id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn ping_connection(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<(), IpcError> {
    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        Arc::clone(&active.connection)
    };
    conn.ping()
        .await
        .map_err(IpcError::from)
}
