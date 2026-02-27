use tauri::State;
use uuid::Uuid;

use dataforge_core::models::query::{QueryHistoryEntry, QueryResult, QueryStatus};
use dataforge_engine::event_bus::AppEvent;

use crate::state::AppState;

#[tauri::command]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<QueryResult, String> {
    let query_id = Uuid::new_v4();

    state.event_bus.emit(AppEvent::QueryStarted {
        query_id,
        sql: sql.clone(),
    });

    let start = std::time::Instant::now();

    let active = state
        .connection_manager
        .get(&connection_id)
        .ok_or("Connection not found")?;

    match active.connection.execute(&sql).await {
        Ok(mut result) => {
            result.query_id = query_id;
            result.execution_time_ms = start.elapsed().as_millis() as u64;

            let history_entry = QueryHistoryEntry {
                id: query_id,
                connection_id,
                sql,
                executed_at: chrono::Utc::now(),
                duration_ms: result.execution_time_ms,
                row_count: Some(result.rows.len() as u64),
                status: QueryStatus::Success,
                error_message: None,
            };
            let _ = state.config_store.add_to_history(&history_entry).await;

            state.event_bus.emit(AppEvent::QueryCompleted {
                query_id,
                row_count: result.rows.len() as u64,
                elapsed_ms: result.execution_time_ms,
            });

            Ok(result)
        }
        Err(e) => {
            state.event_bus.emit(AppEvent::QueryError {
                query_id,
                error: e.to_string(),
            });
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    query_id: Uuid,
) -> Result<(), String> {
    let active = state
        .connection_manager
        .get(&connection_id)
        .ok_or("Connection not found")?;
    active
        .connection
        .cancel_query(&query_id)
        .await
        .map_err(|e| e.to_string())?;
    state
        .event_bus
        .emit(AppEvent::QueryCancelled { query_id });
    Ok(())
}

#[tauri::command]
pub async fn get_query_history(
    state: State<'_, AppState>,
    connection_id: Uuid,
    limit: Option<u32>,
) -> Result<Vec<QueryHistoryEntry>, String> {
    state
        .config_store
        .get_history(&connection_id, limit.unwrap_or(100))
        .await
        .map_err(|e| e.to_string())
}
