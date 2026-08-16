use tauri::State;
use uuid::Uuid;

use purrql_core::error::IpcError;
use purrql_core::models::query::SavedQuery;

use crate::state::AppState;

#[tauri::command]
pub async fn save_saved_query(
    state: State<'_, AppState>,
    query: SavedQuery,
) -> Result<(), IpcError> {
    state
        .config_store
        .upsert_saved_query(query)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn list_saved_queries(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<SavedQuery>, IpcError> {
    state
        .config_store
        .list_saved_queries(&connection_id)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn delete_saved_query(
    state: State<'_, AppState>,
    id: Uuid,
) -> Result<(), IpcError> {
    state
        .config_store
        .delete_saved_query(&id)
        .await
        .map_err(IpcError::from)
}
