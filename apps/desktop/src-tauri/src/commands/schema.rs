use std::sync::Arc;

use tauri::State;
use uuid::Uuid;

use dataforge_core::error::IpcError;
use dataforge_core::models::schema::*;

use crate::state::AppState;

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<DatabaseInfo>, IpcError> {
    let inspector = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Not connected"))?;
        Arc::clone(&active.schema_inspector)
    };
    inspector
        .list_databases()
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: String,
) -> Result<Vec<SchemaInfo>, IpcError> {
    let inspector = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Not connected"))?;
        Arc::clone(&active.schema_inspector)
    };
    inspector
        .list_schemas(&database)
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, IpcError> {
    let (cached, needs_refresh) = state
        .schema_cache
        .get_tables(&connection_id, &database, schema.as_deref());

    if let Some(tables) = cached {
        if !needs_refresh {
            return Ok(tables.as_ref().clone());
        }
        // Return stale data immediately but spawn a background refresh
        let cache = state.schema_cache.clone();
        let conn_id = connection_id;
        let db = database.clone();
        let sch = schema.clone();
        let result = tables.as_ref().clone();
        // Clone the inspector out of the DashMap guard so it can be sent to the task
        let inspector = state
            .connection_manager
            .get(&conn_id)
            .map(|active| Arc::clone(&active.schema_inspector));
        if let Some(inspector) = inspector {
            tokio::spawn(async move {
                if let Ok(fresh) = inspector.list_tables(&db, sch.as_deref()).await {
                    cache.set_tables(conn_id, db, sch, fresh);
                }
            });
        }
        return Ok(result);
    }

    let inspector = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Not connected"))?;
        Arc::clone(&active.schema_inspector)
    };
    let tables = inspector
        .list_tables(&database, schema.as_deref())
        .await
        .map_err(IpcError::from)?;

    state
        .schema_cache
        .set_tables(connection_id, database, schema, tables.clone());

    Ok(tables)
}

#[tauri::command]
pub async fn get_table_structure(
    state: State<'_, AppState>,
    connection_id: Uuid,
    table_ref: TableRef,
) -> Result<TableStructure, IpcError> {
    let inspector = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Not connected"))?;
        Arc::clone(&active.schema_inspector)
    };
    inspector
        .get_table_structure(&table_ref)
        .await
        .map_err(IpcError::from)
}
