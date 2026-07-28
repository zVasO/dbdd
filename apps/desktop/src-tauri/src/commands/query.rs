use std::sync::Arc;

use dashmap::DashMap;
use futures::stream::{self, StreamExt};
use tauri::{Emitter, State};
use tokio::sync::watch;
use tracing::instrument;
use uuid::Uuid;

use serde::Serialize;

use purrql_core::error::{IpcError, PurrqlError};
use purrql_core::models::columnar::{column_kind_for_data_type, ColumnData, ColumnKind};
use purrql_core::models::query::{QueryHistoryEntry, QueryResult, QueryStatus};
use purrql_engine::event_bus::AppEvent;
use purrql_engine::schema_cache;

use crate::state::AppState;

/// Payload emitted for each streaming chunk, avoiding double serialization.
#[derive(Clone, Serialize)]
struct ChunkPayload {
    offset: usize,
    data: Vec<ColumnData>,
}

/// Maximum rows returned for a SELECT without explicit LIMIT.
const SAFETY_ROW_LIMIT: usize = 50_000;

type Cancellers = DashMap<Uuid, watch::Sender<bool>>;

/// Register a cancellation channel for `query_id` and return its receiver.
fn register_canceller(cancellers: &Cancellers, query_id: Uuid) -> watch::Receiver<bool> {
    let (tx, rx) = watch::channel(false);
    cancellers.insert(query_id, tx);
    rx
}

/// Signal cancellation for `query_id` and drop its channel, so a second
/// cancel (or the query's own completion) finds nothing left to purge.
/// Returns whether a live query was registered.
fn signal_cancel(cancellers: &Cancellers, query_id: &Uuid) -> bool {
    match cancellers.remove(query_id) {
        Some((_, tx)) => {
            let _ = tx.send(true);
            true
        }
        None => false,
    }
}

/// Strip leading SQL comments (line and block) to find the first real keyword.
fn strip_leading_comments(sql: &str) -> &str {
    let mut s = sql.trim_start();
    loop {
        if s.starts_with("--") {
            s = s.find('\n').map_or("", |i| &s[i + 1..]).trim_start();
        } else if s.starts_with("/*") {
            s = s.get(2..).and_then(|r| r.find("*/").map(|i| &r[i + 2..])).unwrap_or("").trim_start();
        } else {
            break;
        }
    }
    s
}

/// Remove SQL line (`-- ...`) and block (`/* ... */`) comments so keyword
/// detection isn't fooled by a row-limiting keyword that only appears inside
/// a comment (or separated from the real clause by a long trailing one).
///
/// Quote-aware: `--`/`/*` inside a `'...'` string literal or a `"..."`
/// quoted identifier are left untouched, including the doubled-quote
/// (`''` / `""`) escape for a literal quote character within one, so a
/// comment marker embedded in a literal never swallows real SQL that
/// follows it (e.g. an actual trailing `LIMIT`).
fn strip_comments(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut rest = sql;
    let mut quote: Option<char> = None;
    while !rest.is_empty() {
        let ch = rest.chars().next().expect("rest is non-empty");
        if let Some(q) = quote {
            out.push(ch);
            rest = &rest[ch.len_utf8()..];
            if ch == q {
                if rest.starts_with(q) {
                    out.push(q);
                    rest = &rest[q.len_utf8()..];
                } else {
                    quote = None;
                }
            }
        } else if ch == '\'' || ch == '"' {
            quote = Some(ch);
            out.push(ch);
            rest = &rest[ch.len_utf8()..];
        } else if rest.starts_with("--") {
            match rest.find('\n') {
                Some(i) => {
                    out.push('\n');
                    rest = &rest[i + 1..];
                }
                None => break,
            }
        } else if rest.starts_with("/*") {
            match rest[2..].find("*/") {
                Some(i) => {
                    out.push(' ');
                    rest = &rest[2 + i + 2..];
                }
                None => break,
            }
        } else {
            out.push(ch);
            rest = &rest[ch.len_utf8()..];
        }
    }
    out
}

/// Whether `sql` contains a row-limiting keyword (`LIMIT`, or `FETCH` as in
/// the standard `FETCH FIRST ... ROWS ONLY` / `OFFSET ... FETCH NEXT ...`
/// forms) as a standalone token, not merely as a substring of an identifier
/// like `rate_limit_exceeded`.
fn has_limit_keyword(sql: &str) -> bool {
    strip_comments(sql)
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .any(|tok| tok.eq_ignore_ascii_case("LIMIT") || tok.eq_ignore_ascii_case("FETCH"))
}

/// Detect whether a SQL string is a SELECT-like query missing a LIMIT clause.
/// Handles CTEs (`WITH ... SELECT`) and leading SQL comments.
fn needs_safety_limit(sql: &str) -> bool {
    let stripped = strip_leading_comments(sql);
    let trimmed = stripped.trim_end_matches(';').trim();

    // Match SELECT or WITH (CTE) queries
    let is_select = trimmed.get(..6).is_some_and(|s| s.eq_ignore_ascii_case("SELECT"));
    let is_cte = trimmed.get(..4).is_some_and(|s| s.eq_ignore_ascii_case("WITH"));

    if !is_select && !is_cte {
        return false;
    }

    !has_limit_keyword(trimmed)
}

fn apply_safety_limit(sql: &str) -> String {
    let trimmed = sql.trim().trim_end_matches(';');
    // A leading newline (rather than a space) guarantees the clause survives
    // even if `trimmed` ends in an unterminated `--` line comment: a newline
    // closes such a comment in every dialect, so the LIMIT always lands as
    // live SQL instead of being swallowed into the comment.
    format!("{}\nLIMIT {}", trimmed, SAFETY_ROW_LIMIT)
}

#[tauri::command]
#[instrument(skip(state, connection_id, sql, query_id), fields(query_id, row_count))]
pub async fn execute_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    query_id: Option<Uuid>,
) -> Result<QueryResult, IpcError> {
    let query_id = query_id.unwrap_or_else(Uuid::new_v4);
    tracing::Span::current().record("query_id", query_id.to_string());

    state.event_bus.emit(AppEvent::query_started(query_id, &sql));

    let start = std::time::Instant::now();

    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        Arc::clone(&active.connection)
    };

    let effective_sql = if needs_safety_limit(&sql) {
        apply_safety_limit(&sql)
    } else {
        sql.clone()
    };

    let mut cancel_rx = register_canceller(&state.stream_cancellers, query_id);
    let outcome = tokio::select! {
        biased;
        _ = cancel_rx.changed() => return Err(IpcError::from(PurrqlError::QueryCancelled)),
        result = conn.execute(&effective_sql) => result,
    };
    state.stream_cancellers.remove(&query_id);

    match outcome {
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
                    if let Err(e) = config_store.add_to_history(&entry).await {
                        tracing::warn!(error = %e, "Failed to write query history");
                    }
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
            Err(IpcError::from(e))
        }
    }
}

/// Columnar variant of `execute_query`.
///
/// Instead of delegating to `execute_query` (which builds a row-based `QueryResult`)
/// and then converting via `ColumnarResult::from`, this command inlines the same
/// safety-limit / history / event logic and converts directly using
/// `ColumnarResult::from_query_result_consuming`. The consuming path moves
/// heap-allocated values (String, serde_json::Value) out of cells via
/// `std::mem::take` rather than cloning them, saving one allocation per
/// string/JSON cell.
///
/// The row-to-columnar transpose itself is unavoidable at the current driver
/// level because all drivers return `QueryResult { rows: Vec<Row> }`.
/// A native columnar return path in the driver trait would eliminate this
/// transpose entirely, but that is a larger refactor tracked separately.
#[tauri::command]
#[instrument(skip(state, connection_id, sql, query_id), fields(query_id, row_count))]
pub async fn execute_query_columnar(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    query_id: Option<Uuid>,
) -> Result<purrql_core::models::columnar::ColumnarResult, IpcError> {
    let query_id = query_id.unwrap_or_else(Uuid::new_v4);
    tracing::Span::current().record("query_id", query_id.to_string());

    state.event_bus.emit(AppEvent::query_started(query_id, &sql));

    let start = std::time::Instant::now();

    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        Arc::clone(&active.connection)
    };

    let effective_sql = if needs_safety_limit(&sql) {
        apply_safety_limit(&sql)
    } else {
        sql.clone()
    };

    let mut cancel_rx = register_canceller(&state.stream_cancellers, query_id);
    let outcome = tokio::select! {
        biased;
        _ = cancel_rx.changed() => return Err(IpcError::from(PurrqlError::QueryCancelled)),
        result = conn.execute(&effective_sql) => result,
    };
    state.stream_cancellers.remove(&query_id);

    match outcome {
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
                    if let Err(e) = config_store.add_to_history(&entry).await {
                        tracing::warn!(error = %e, "Failed to write query history");
                    }
                });
            }

            state.event_bus.emit(AppEvent::QueryCompleted {
                query_id,
                row_count,
                elapsed_ms: result.execution_time_ms,
            });

            if is_ddl {
                state.schema_cache.invalidate_connection(&connection_id);
            }

            // Convert directly via consuming path — moves strings/JSON out of
            // cells instead of cloning, saving one heap allocation per cell.
            Ok(purrql_core::models::columnar::ColumnarResult::from_query_result_consuming(result))
        }
        Err(e) => {
            state.event_bus.emit(AppEvent::QueryError {
                query_id,
                error: e.to_string(),
            });
            Err(IpcError::from(e))
        }
    }
}

#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    connection_id: Uuid,
    query_id: Uuid,
) -> Result<(), IpcError> {
    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        Arc::clone(&active.connection)
    };
    // Without a registered canceller nothing of ours is still running, and the
    // driver call must be skipped rather than merely tolerated: the Postgres
    // implementation ignores `query_id` and cancels whichever backend it finds
    // active, so a cancel with nothing to cancel can only hit someone else's
    // query. Abandoning the wait is what frees the tab; drivers with no
    // server-side cancellation fail here harmlessly.
    if signal_cancel(&state.stream_cancellers, &query_id) {
        if let Err(e) = conn.cancel_query(&query_id).await {
            tracing::debug!(error = %e, "Driver-level cancellation unavailable");
        }
    }
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
) -> Result<Vec<QueryHistoryEntry>, IpcError> {
    state
        .config_store
        .get_history(&connection_id, limit.unwrap_or(100))
        .await
        .map_err(IpcError::from)
}

#[tauri::command]
pub async fn execute_batch(
    state: State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
) -> Result<Vec<Result<QueryResult, IpcError>>, IpcError> {
    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        Arc::clone(&active.connection)
    };

    // Check for DDL before consuming statements
    let has_ddl = statements.iter().any(|sql| schema_cache::is_ddl(sql));

    let results: Vec<Result<QueryResult, IpcError>> = if has_ddl {
        // DDL present — execute ALL statements sequentially to preserve ordering
        // (e.g., CREATE TABLE must complete before INSERT INTO that table)
        let mut results = Vec::with_capacity(statements.len());
        for sql in statements {
            let effective_sql = if needs_safety_limit(&sql) {
                apply_safety_limit(&sql)
            } else {
                sql
            };
            let result = match conn.execute(&effective_sql).await {
                Ok(r) => Ok(r),
                Err(e) => Err(IpcError::from(e)),
            };
            results.push(result);
        }
        results
    } else {
        // Pure DML — safe to execute concurrently
        const MAX_BATCH_CONCURRENCY: usize = 4;
        stream::iter(statements.into_iter().map(|sql| {
            let conn = Arc::clone(&conn);
            async move {
                let effective_sql = if needs_safety_limit(&sql) {
                    apply_safety_limit(&sql)
                } else {
                    sql
                };
                match conn.execute(&effective_sql).await {
                    Ok(result) => Ok(result),
                    Err(e) => Err(IpcError::from(e)),
                }
            }
        }))
        .buffered(MAX_BATCH_CONCURRENCY)
        .collect()
        .await
    };

    // Auto-invalidate schema cache if any statement was DDL
    if has_ddl {
        state.schema_cache.invalidate_connection(&connection_id);
    }

    Ok(results)
}

#[tauri::command]
#[instrument(skip(state, app, connection_id, sql))]
pub async fn execute_query_stream(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    connection_id: Uuid,
    sql: String,
    chunk_size: Option<usize>,
    query_id: Option<Uuid>,
) -> Result<String, IpcError> {
    let query_id = query_id.unwrap_or_else(Uuid::new_v4);
    let chunk_size = chunk_size.unwrap_or(1000);

    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        Arc::clone(&active.connection)
    };

    state.event_bus.emit(AppEvent::query_started(query_id, &sql));

    let start = std::time::Instant::now();
    let app_clone = app.clone();
    let event_bus = state.event_bus.clone();
    let config_store = state.config_store.clone();

    let effective_sql = if needs_safety_limit(&sql) {
        apply_safety_limit(&sql)
    } else {
        sql.clone()
    };

    // Create a cancellation channel for this streaming query
    let mut cancel_rx = register_canceller(&state.stream_cancellers, query_id);
    let cancellers = state.stream_cancellers.clone();

    // Pre-compute event names to avoid per-iteration allocations
    let event_meta = format!("query_meta_{}", query_id);
    let event_chunk = format!("query_chunk_{}", query_id);
    let event_error = format!("query_error_{}", query_id);
    let event_done = format!("query_done_{}", query_id);
    let event_cancelled = format!("query_cancelled_{}", query_id);

    tokio::spawn(async move {
        // A cancelled stream must still deliver a terminal per-query event:
        // the frontend keys listener teardown and the tab's executing state
        // off these, never off the global bus.
        let emit_cancelled = |total_rows: usize| {
            let _ = app_clone.emit(
                &event_cancelled,
                serde_json::json!({
                    "total_rows": total_rows,
                    "execution_time_ms": start.elapsed().as_millis() as u64
                }),
            );
            event_bus.emit(AppEvent::QueryCancelled { query_id });
            cancellers.remove(&query_id);
        };

        let stream = tokio::select! {
            biased;
            _ = cancel_rx.changed() => {
                emit_cancelled(0);
                return;
            }
            stream = conn.execute_stream(&effective_sql, chunk_size) => stream,
        };

        match stream {
            Ok((columns, mut rx)) => {
                let col_count = columns.len();

                // Determined once from the same column metadata sent below as
                // `meta.columns`, so no chunk can re-infer a different kind.
                let column_kinds: Vec<ColumnKind> = columns
                    .iter()
                    .map(|c| column_kind_for_data_type(&c.data_type))
                    .collect();
                let column_kind_tags: Vec<&'static str> = column_kinds
                    .iter()
                    .map(ColumnKind::as_column_data_tag)
                    .collect();

                // Emit metadata (row_count unknown until stream completes).
                // `column_kinds` is the same list applied to every chunk below,
                // so the frontend can adopt it directly instead of re-deriving
                // a kind from `data_type` itself.
                let _ = app_clone.emit(
                    &event_meta,
                    serde_json::json!({
                        "query_id": query_id.to_string(),
                        "columns": columns,
                        "column_kinds": column_kind_tags,
                        "result_type": "Select",
                        "warnings": [],
                    }),
                );

                let mut total_rows: usize = 0;
                let mut offset: usize = 0;
                let mut had_error = false;
                let mut cancelled = false;

                loop {
                    let chunk_result = tokio::select! {
                        biased;
                        _ = cancel_rx.changed() => {
                            cancelled = true;
                            break;
                        }
                        chunk = rx.recv() => match chunk {
                            Some(chunk) => chunk,
                            None => break,
                        },
                    };

                    match chunk_result {
                        Ok(rows) => {
                            let chunk_len = rows.len();
                            total_rows += chunk_len;

                            // Pass ColumnData directly; emit serializes once
                            let chunk_data: Vec<ColumnData> =
                                purrql_core::models::columnar::rows_to_columnar_chunk(
                                    &rows, col_count, &column_kinds,
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
                            if let Err(e) = config_store.add_to_history(&entry).await {
                                tracing::warn!(error = %e, "Failed to write query history");
                            }
                            break;
                        }
                    }
                }

                if cancelled {
                    emit_cancelled(total_rows);
                    return;
                }

                // Clean up canceller for this query
                cancellers.remove(&query_id);

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
                cancellers.remove(&query_id);
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

#[cfg(test)]
mod tests {
    use super::{
        apply_safety_limit, needs_safety_limit, register_canceller, signal_cancel, Cancellers,
        SAFETY_ROW_LIMIT,
    };
    use uuid::Uuid;

    #[test]
    fn cancelling_signals_the_receiver_and_purges_the_registration() {
        let cancellers = Cancellers::new();
        let query_id = Uuid::new_v4();
        let rx = register_canceller(&cancellers, query_id);

        assert!(!*rx.borrow());
        assert!(signal_cancel(&cancellers, &query_id));
        assert!(*rx.borrow());
        assert!(cancellers.is_empty());
    }

    #[test]
    fn cancelling_an_unknown_or_already_cancelled_query_is_a_no_op() {
        let cancellers = Cancellers::new();
        let query_id = Uuid::new_v4();

        assert!(!signal_cancel(&cancellers, &query_id));

        register_canceller(&cancellers, query_id);
        assert!(signal_cancel(&cancellers, &query_id));
        assert!(!signal_cancel(&cancellers, &query_id));
    }

    #[test]
    fn cancelling_one_query_leaves_other_registrations_alone() {
        let cancellers = Cancellers::new();
        let cancelled = Uuid::new_v4();
        let running = Uuid::new_v4();
        register_canceller(&cancellers, cancelled);
        let running_rx = register_canceller(&cancellers, running);

        signal_cancel(&cancellers, &cancelled);

        assert!(!*running_rx.borrow());
        assert!(cancellers.contains_key(&running));
    }

    #[test]
    fn does_not_panic_on_utf8_boundary_in_tail() {
        // A >200-byte SELECT whose byte at len-200 falls mid-multibyte-char.
        let sql = format!("SELECT '{}'", "é".repeat(300));
        assert!(needs_safety_limit(&sql));
    }

    #[test]
    fn detects_missing_limit() {
        assert!(needs_safety_limit("SELECT * FROM users"));
        assert!(needs_safety_limit("WITH x AS (SELECT 1) SELECT * FROM x"));
    }

    #[test]
    fn respects_existing_limit() {
        assert!(!needs_safety_limit("SELECT * FROM users LIMIT 10"));
    }

    #[test]
    fn ignores_non_select() {
        assert!(!needs_safety_limit("UPDATE users SET x = 1"));
        assert!(!needs_safety_limit("INSERT INTO users (id) VALUES (1)"));
    }

    #[test]
    fn identifier_containing_limit_is_not_a_false_positive() {
        assert!(needs_safety_limit(
            "SELECT * FROM t WHERE rate_limit_exceeded = true"
        ));
    }

    #[test]
    fn limit_followed_by_long_trailing_comment_is_not_a_false_negative() {
        let sql = format!(
            "SELECT * FROM t LIMIT 10 -- {}",
            "long comment ".repeat(20)
        );
        assert!(sql.len() > 200);
        assert!(!needs_safety_limit(&sql));
    }

    #[test]
    fn limit_string_literal_is_a_documented_false_negative_not_invalid_sql() {
        // "LIMIT" inside a string literal is indistinguishable from a real
        // keyword by this token-based check, so worst case we skip adding
        // the safety limit — we never emit a second, syntactically invalid
        // LIMIT clause.
        assert!(!needs_safety_limit("SELECT 'LIMIT'"));
    }

    #[test]
    fn safety_limit_survives_unterminated_trailing_comment() {
        let sql = "select * from t -- trailing comment without newline";
        assert!(needs_safety_limit(sql));
        // The leading newline before LIMIT closes the `--` comment in every
        // dialect, so the appended clause lands as live SQL, not more comment.
        assert_eq!(
            apply_safety_limit(sql),
            format!("{}\nLIMIT {}", sql, SAFETY_ROW_LIMIT)
        );
    }

    #[test]
    fn comment_marker_inside_string_literal_does_not_hide_a_real_trailing_limit() {
        // A `--` or `/*` inside a string literal must not be treated as the
        // start of a comment: doing so would swallow the real `limit 10`
        // that follows, causing a second LIMIT to be appended (invalid SQL).
        assert!(!needs_safety_limit(
            "select * from t where x = '--' limit 10"
        ));
        assert!(!needs_safety_limit(
            "select * from t where x = 'a/*b' limit 10"
        ));
    }

    #[test]
    fn comment_marker_inside_string_literal_without_limit_still_gets_one() {
        let sql = "select '--' from t";
        assert!(needs_safety_limit(sql));
        assert_eq!(
            apply_safety_limit(sql),
            format!("{}\nLIMIT {}", sql, SAFETY_ROW_LIMIT)
        );
    }
}
