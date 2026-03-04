use tauri::State;
use uuid::Uuid;

use dataforge_core::models::connection::{ConnectionConfig, SavedConnection};
use dataforge_engine::event_bus::AppEvent;

use crate::state::AppState;

#[tauri::command]
pub async fn connect(
    state: State<'_, AppState>,
    config: ConnectionConfig,
    password: Option<String>,
) -> Result<Uuid, String> {
    state
        .config_store
        .save_connection(&config)
        .await
        .map_err(|e| e.to_string())?;

    // If a password is provided, store it securely. Otherwise, try to retrieve a stored one.
    let effective_password = if let Some(ref pw) = password {
        state
            .config_store
            .store_password(&config.id, pw)
            .map_err(|e| e.to_string())?;
        Some(pw.clone())
    } else {
        state
            .config_store
            .get_password(&config.id)
            .map_err(|e| e.to_string())?
    };

    let connection_id = state
        .connection_manager
        .connect(&config, effective_password.as_deref())
        .await
        .map_err(|e| e.to_string())?;

    state
        .event_bus
        .emit(AppEvent::ConnectionEstablished { connection_id });

    Ok(connection_id)
}

#[tauri::command]
pub async fn disconnect(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<(), String> {
    state
        .connection_manager
        .disconnect(&connection_id)
        .await
        .map_err(|e| e.to_string())?;
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
) -> Result<String, String> {
    let factory = state
        .driver_registry
        .get_factory(&config.db_type)
        .ok_or("Driver not found")?;
    let conn = factory
        .create_connection(&config, password.as_deref())
        .await
        .map_err(|e| e.to_string())?;
    conn.ping().await.map_err(|e| e.to_string())?;
    let version = conn.server_version().await.map_err(|e| e.to_string())?;
    let _ = conn.close().await;
    Ok(version)
}

#[tauri::command]
pub async fn list_saved_connections(
    state: State<'_, AppState>,
) -> Result<Vec<SavedConnection>, String> {
    state
        .config_store
        .list_connections()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_saved_connection(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<(), String> {
    state
        .config_store
        .delete_connection(&id)
        .await
        .map_err(|e| e.to_string())
}
