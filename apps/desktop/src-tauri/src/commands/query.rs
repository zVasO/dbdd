use std::sync::Arc;

use futures::stream::{self, StreamExt};
use tauri::{Emitter, State};
use tracing::instrument;
use uuid::Uuid;

use serde::Serialize;

use dataforge_core::models::columnar::ColumnData;
use dataforge_core::models::query::{QueryHistoryEntry, QueryResult, QueryStatus};
use dataforge_engine::event_bus::AppEvent;
use dataforge_engine::schema_cache;

use crate::state::AppState;

/// Payload emitted for each streaming chunk, avoiding double serialization.
#[derive(Clone, Serialize)]
struct ChunkPayload {
    offset: usize,
    data: Vec<ColumnData>,
}

/// Maximum rows returned for a SELECT without explicit LIMIT.
const SAFETY_ROW_LIMIT: usize = 50_000;

/// Detect whether a SQL string is a SELECT-like query missing a LIMIT clause.
fn needs_safety_limit(sql: &str) -> bool {
    let trimmed = sql.trim().trim_end_matches(';').trim();
    // Case-insensitive check without allocating a full uppercase copy
    if !trimmed.get(..6).is_some_and(|s| s.eq_ignore_ascii_case("SELECT")) {
        return false;
    }
    // Case-insensitive search for LIMIT in the tail without allocating
    let len = trimmed.len();
    let start = len.saturating_sub(200);
    let tail = &trimmed[start..];
    let tail_bytes = tail.as_bytes();
    let limit_bytes = b"LIMIT";
    let has_limit = tail_bytes.windows(limit_bytes.len()).any(|window| {
        window.eq_ignore_ascii_case(limit_bytes)
    });
    !has_limit
}

fn apply_safety_limit(sql: &str) -> String {
    let trimmed = sql.trim().trim_end_matches(';');
    format!("{} LIMIT {}", trimmed, SAFETY_ROW_LIMIT)
}

#[tauri::command]
#[instrument(skip(state), fields(query_id, row_count))]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<QueryResult, String> {
    let query_id = Uuid::new_v4();
    tracing::Span::current().record("query_id", query_id.to_string());

    state.event_bus.emit(AppEvent::QueryStarted {
        query_id,
        sql: sql.clone(),
    });

    let start = std::time::Instant::now();

    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or("Connection not found")?;
        Arc::clone(&active.connection)
    };

    let effective_sql = if needs_safety_limit(&sql) {
        apply_safety_limit(&sql)
    } else {
        sql.clone()
    };

    match conn.execute(&effective_sql).await {
        Ok(mut result) => {
            result.query_id = query_id;
            result.execution_time_ms = start.elapsed().as_millis() as u64;

            let row_count = result.rows.len() as u64;
            tracing::Span::current().record("row_count", row_count);

            let is_ddl = schema_cache::is_ddl(&sql);

            let history_entry = QueryHistoryEntry {
                id: query_id,
                connection_id,
                sql,
                executed_at: chrono::Utc::now(),
                duration_ms: result.execution_time_ms,
                row_count: Some(row_count),
                status: QueryStatus::Success,
                error_message: None,
            };
            {
                let config_store = state.config_store.clone();
                let entry = history_entry.clone();
                tokio::spawn(async move {
                    let _ = config_store.add_to_history(&entry).await;
                });
            }

            state.event_bus.emit(AppEvent::QueryCompleted {
                query_id,
                row_count,
                elapsed_ms: result.execution_time_ms,
            });

            // Auto-invalidate schema cache on DDL statements
            if is_ddl {
                state.schema_cache.invalidate_connection(&connection_id);
            }

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
#[instrument(skip(state))]
pub async fn execute_query_columnar(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
) -> Result<dataforge_core::models::columnar::ColumnarResult, String> {
    let result = execute_query(state, connection_id, sql).await?;
    Ok(dataforge_core::models::columnar::ColumnarResult::from(result))
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    query_id: Uuid,
) -> Result<(), String> {
    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or("Connection not found")?;
        Arc::clone(&active.connection)
    };
    conn.cancel_query(&query_id)
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

#[tauri::command]
pub async fn execute_batch(
    state: State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
) -> Result<Vec<Result<QueryResult, String>>, String> {
    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or("Connection not found")?;
        Arc::clone(&active.connection)
    };

    const MAX_BATCH_CONCURRENCY: usize = 4;

    // Check for DDL before consuming statements
    let has_ddl = statements.iter().any(|sql| schema_cache::is_ddl(sql));

    let results: Vec<Result<QueryResult, String>> = stream::iter(statements.into_iter().map(|sql| {
        let conn = Arc::clone(&conn);
        async move {
            match conn.execute(&sql).await {
                Ok(result) => Ok(result),
                Err(e) => Err(e.to_string()),
            }
        }
    }))
    .buffered(MAX_BATCH_CONCURRENCY)
    .collect()
    .await;

    // Auto-invalidate schema cache if any statement was DDL
    if has_ddl {
        state.schema_cache.invalidate_connection(&connection_id);
    }

    Ok(results)
}

#[tauri::command]
#[instrument(skip(state, app))]
pub async fn execute_query_stream(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    connection_id: Uuid,
    sql: String,
    chunk_size: Option<usize>,
) -> Result<String, String> {
    let query_id = Uuid::new_v4();
    let chunk_size = chunk_size.unwrap_or(1000);

    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or("Connection not found")?;
        Arc::clone(&active.connection)
    };

    state.event_bus.emit(AppEvent::QueryStarted {
        query_id,
        sql: sql.clone(),
    });

    let start = std::time::Instant::now();
    let app_clone = app.clone();
    let event_bus = state.event_bus.clone();
    let config_store = state.config_store.clone();

    let effective_sql = if needs_safety_limit(&sql) {
        apply_safety_limit(&sql)
    } else {
        sql.clone()
    };

    // Pre-compute event names to avoid per-iteration allocations
    let event_meta = format!("query_meta_{}", query_id);
    let event_chunk = format!("query_chunk_{}", query_id);
    let event_error = format!("query_error_{}", query_id);
    let event_done = format!("query_done_{}", query_id);

    tokio::spawn(async move {
        match conn.execute_stream(&effective_sql, chunk_size).await {
            Ok((columns, mut rx)) => {
                let col_count = columns.len();

                // Emit metadata (row_count unknown until stream completes)
                let _ = app_clone.emit(
                    &event_meta,
                    serde_json::json!({
                        "query_id": query_id.to_string(),
                        "columns": columns,
                        "result_type": "Select",
                        "warnings": [],
                    }),
                );

                let mut total_rows: usize = 0;
                let mut offset: usize = 0;
                let mut had_error = false;

                while let Some(chunk_result) = rx.recv().await {
                    match chunk_result {
                        Ok(rows) => {
                            let chunk_len = rows.len();
                            total_rows += chunk_len;

                            // Pass ColumnData directly; emit serializes once
                            let chunk_data: Vec<ColumnData> =
                                dataforge_core::models::columnar::rows_to_columnar_chunk(
                                    &rows, col_count,
                                );

                            let _ = app_clone.emit(
                                &event_chunk,
                                ChunkPayload {
                                    offset,
                                    data: chunk_data,
                                },
                            );
                            offset += chunk_len;
                        }
                        Err(e) => {
                            had_error = true;
                            let elapsed_ms = start.elapsed().as_millis() as u64;
                            let _ = app_clone.emit(
                                &event_error,
                                serde_json::json!({ "error": e.to_string() }),
                            );
                            event_bus.emit(AppEvent::QueryError {
                                query_id,
                                error: e.to_string(),
                            });
                            let entry = QueryHistoryEntry {
                                id: query_id,
                                connection_id,
                                sql: sql.clone(),
                                executed_at: chrono::Utc::now(),
                                duration_ms: elapsed_ms,
                                row_count: None,
                                status: QueryStatus::Error,
                                error_message: Some(e.to_string()),
                            };
                            let _ = config_store.add_to_history(&entry).await;
                            break;
                        }
                    }
                }

                if !had_error {
                    let elapsed_ms = start.elapsed().as_millis() as u64;

                    let _ = app_clone.emit(
                        &event_done,
                        serde_json::json!({
                            "total_rows": total_rows,
                            "execution_time_ms": elapsed_ms
                        }),
                    );

                    event_bus.emit(AppEvent::QueryCompleted {
                        query_id,
                        row_count: total_rows as u64,
                        elapsed_ms,
                    });

                    let entry = QueryHistoryEntry {
                        id: query_id,
                        connection_id,
                        sql,
                        executed_at: chrono::Utc::now(),
                        duration_ms: elapsed_ms,
                        row_count: Some(total_rows as u64),
                        status: QueryStatus::Success,
                        error_message: None,
                    };
                    let _ = config_store.add_to_history(&entry).await;
                }
            }
            Err(e) => {
                let elapsed_ms = start.elapsed().as_millis() as u64;
                let _ = app_clone.emit(
                    &event_error,
                    serde_json::json!({ "error": e.to_string() }),
                );
                event_bus.emit(AppEvent::QueryError {
                    query_id,
                    error: e.to_string(),
                });
                let entry = QueryHistoryEntry {
                    id: query_id,
                    connection_id,
                    sql,
                    executed_at: chrono::Utc::now(),
                    duration_ms: elapsed_ms,
                    row_count: None,
                    status: QueryStatus::Error,
                    error_message: Some(e.to_string()),
                };
                let _ = config_store.add_to_history(&entry).await;
            }
        }
    });

    Ok(query_id.to_string())
}
