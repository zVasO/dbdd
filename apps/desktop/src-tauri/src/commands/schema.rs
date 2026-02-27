use tauri::State;
use uuid::Uuid;

use dataforge_core::models::schema::*;

use crate::state::AppState;

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    connection_id: Uuid,
) -> Result<Vec<DatabaseInfo>, String> {
    let active = state
        .connection_manager
        .get(&connection_id)
        .ok_or("Not connected")?;
    active
        .schema_inspector
        .list_databases()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_schemas(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: String,
) -> Result<Vec<SchemaInfo>, String> {
    let active = state
        .connection_manager
        .get(&connection_id)
        .ok_or("Not connected")?;
    active
        .schema_inspector
        .list_schemas(&database)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    connection_id: Uuid,
    database: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, String> {
    if let Some(cached) =
        state
            .schema_cache
            .get_tables(&connection_id, &database, schema.as_deref())
    {
        return Ok(cached);
    }

    let active = state
        .connection_manager
        .get(&connection_id)
        .ok_or("Not connected")?;
    let tables = active
        .schema_inspector
        .list_tables(&database, schema.as_deref())
        .await
        .map_err(|e| e.to_string())?;

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
) -> Result<TableStructure, String> {
    let active = state
        .connection_manager
        .get(&connection_id)
        .ok_or("Not connected")?;
    active
        .schema_inspector
        .get_table_structure(&table_ref)
        .await
        .map_err(|e| e.to_string())
}
