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
use purrql_core::ports::connection::DatabaseConnection;
use purrql_engine::event_bus::{AppEvent, EventBus};
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

/// Longest the local cancel signal may wait on the driver-side cancel. The
/// Postgres driver acquires from the same pool the query saturates, where an
/// acquire can stall for its full 10s timeout; past this bound, freeing the
/// tab wins over confirming the server-side cancel.
const DRIVER_CANCEL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Cancel a registered query: driver-side first, local waiter second.
///
/// The order matters. Waking the waiter drops the query future, and with it
/// the driver's record of which backend runs the query (e.g. the Postgres
/// pid registration) — signalling first can erase the very record
/// `driver_cancel` needs, leaving the statement running server-side.
/// Returns whether a live query was registered; without one nothing of ours
/// is still running, so the driver is never consulted.
///
/// The registration check and the signal are deliberately not atomic: a
/// concurrent cancel or a natural completion in between only makes
/// `driver_cancel` target a backend that is idle or already gone, a server-
/// side no-op, and `signal_cancel` is idempotent.
async fn cancel_tracked_query<F, Fut>(
    cancellers: &Cancellers,
    query_id: &Uuid,
    driver_cancel: F,
) -> bool
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = purrql_core::error::Result<()>>,
{
    if !cancellers.contains_key(query_id) {
        return false;
    }
    match tokio::time::timeout(DRIVER_CANCEL_TIMEOUT, driver_cancel()).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::debug!(error = %e, "Driver-level cancellation unavailable"),
        Err(_) => tracing::debug!("Driver-level cancellation timed out"),
    }
    signal_cancel(cancellers, query_id)
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

/// A word token of a SQL string, tagged with the context needed to tell a
/// clause-level keyword from one nested inside a subquery.
struct Token<'a> {
    word: &'a str,
    /// Parenthesis nesting depth the token appears at. Parens inside string
    /// literals and quoted identifiers don't count.
    depth: u32,
    /// Whether only whitespace separated this token from the previous one.
    adjacent: bool,
}

/// Result of scanning a SQL string into depth-tagged word tokens.
struct TokenScan<'a> {
    tokens: Vec<Token<'a>>,
    /// Whether the scan ended with every parenthesis closed and every quote
    /// terminated. Syntaxes the tokenizer doesn't model — MySQL `\'`
    /// backslash escapes, Postgres `$$...$$` dollar-quoting — can leave it
    /// unbalanced, and then every depth tag is suspect: a caller must not
    /// use depth to dismiss a token it would otherwise act on.
    reliable: bool,
}

/// Split `sql` (already comment-stripped) into word tokens tagged with their
/// parenthesis depth.
///
/// Only the depth tracking is quote-aware: a `(` or `)` inside a `'...'`
/// literal or a `"..."` identifier is literal text and must not shift the
/// depth of the real SQL around it. Words *inside* quotes are still emitted
/// as tokens, which keeps `SELECT 'LIMIT'` wrongly reported as bounded —
/// deliberately, since suppressing the safety limit is the safe failure mode
/// and never produces a second, invalid LIMIT clause.
fn depth_tagged_tokens(sql: &str) -> TokenScan<'_> {
    let mut tokens: Vec<Token<'_>> = Vec::new();
    let mut depth: u32 = 0;
    let mut quote: Option<char> = None;
    let mut word_start: Option<usize> = None;
    let mut only_ws_since_prev = true;
    let mut chars = sql.char_indices().peekable();
    let mut skip_escaped_quote = false;

    while let Some((i, ch)) = chars.next() {
        if skip_escaped_quote {
            skip_escaped_quote = false;
            continue;
        }

        if ch.is_alphanumeric() || ch == '_' {
            if word_start.is_none() {
                word_start = Some(i);
            }
            continue;
        }

        // Any non-word character terminates the word in progress.
        if let Some(start) = word_start.take() {
            tokens.push(Token {
                word: &sql[start..i],
                depth,
                adjacent: only_ws_since_prev,
            });
            only_ws_since_prev = true;
        }

        match quote {
            Some(q) => {
                if ch == q {
                    // A doubled quote is an escaped quote character, not the
                    // end of the literal.
                    if matches!(chars.peek(), Some((_, c)) if *c == q) {
                        skip_escaped_quote = true;
                    } else {
                        quote = None;
                    }
                }
                only_ws_since_prev = false;
            }
            None => match ch {
                '\'' | '"' => {
                    quote = Some(ch);
                    only_ws_since_prev = false;
                }
                '(' => {
                    depth += 1;
                    only_ws_since_prev = false;
                }
                ')' => {
                    depth = depth.saturating_sub(1);
                    only_ws_since_prev = false;
                }
                c if c.is_whitespace() => {}
                _ => only_ws_since_prev = false,
            },
        }
    }

    if let Some(start) = word_start {
        tokens.push(Token {
            word: &sql[start..],
            depth,
            adjacent: only_ws_since_prev,
        });
    }

    TokenScan {
        tokens,
        reliable: depth == 0 && quote.is_none(),
    }
}

/// Whether `sql` already bounds its own top-level result set with a
/// row-limiting keyword: `LIMIT`, or `FETCH` in the standard
/// `FETCH FIRST/NEXT ... ROWS ONLY` form.
///
/// The keyword must appear as a standalone token (not as part of an
/// identifier like `rate_limit_exceeded`) at parenthesis depth 0. Depth
/// matters because a `LIMIT` that bounds a subquery says nothing about the
/// outer query: `SELECT * FROM huge WHERE id IN (SELECT id FROM small LIMIT 5)`
/// still returns every row of `huge`, so it must keep the safety cap.
/// A bare `FETCH` doesn't count either — it also begins cursor `FETCH`
/// statements, which limit nothing.
///
/// Known false negatives, i.e. queries wrongly reported as already bounded.
/// All of them merely skip the safety limit, which is the safe direction:
/// no second LIMIT clause is ever appended to SQL that has one.
/// - A `LIMIT`/`FETCH` token inside a string literal (`SELECT 'LIMIT'`) —
///   indistinguishable from the keyword without a real SQL parser.
/// - A top-level SELECT wrapped in its own parentheses
///   (`(SELECT ... LIMIT 10)`), whose keyword never reaches depth 0.
/// - Any query whose scan ends unbalanced (unmodeled escapes like MySQL
///   `\'` or Postgres dollar-quoting): the depth tags can't be trusted, so
///   every `LIMIT`/`FETCH` token counts regardless of depth rather than
///   risking a second LIMIT on a query whose real one was mis-tagged. This
///   widens the window: a LIMIT that only bounds a subquery then also skips
///   the safety cap for a genuinely unbounded outer query.
fn has_limit_keyword(sql: &str) -> bool {
    let stripped = strip_comments(sql);
    let scan = depth_tagged_tokens(&stripped);
    let tokens = &scan.tokens;
    let top_level = |depth: u32| !scan.reliable || depth == 0;

    tokens.iter().enumerate().any(|(i, tok)| {
        if !top_level(tok.depth) {
            return false;
        }
        if tok.word.eq_ignore_ascii_case("LIMIT") {
            return true;
        }
        if tok.word.eq_ignore_ascii_case("FETCH") {
            return tokens.get(i + 1).is_some_and(|next| {
                top_level(next.depth)
                    && next.adjacent
                    && (next.word.eq_ignore_ascii_case("FIRST")
                        || next.word.eq_ignore_ascii_case("NEXT"))
            });
        }
        false
    })
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
    record_history: Option<bool>,
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
        result = conn.execute_tracked(&effective_sql, &query_id) => result,
    };
    state.stream_cancellers.remove(&query_id);

    match outcome {
        Ok(mut result) => {
            result.query_id = query_id;
            result.execution_time_ms = start.elapsed().as_millis() as u64;

            let row_count = result.rows.len() as u64;
            tracing::Span::current().record("row_count", row_count);

            let is_ddl = schema_cache::is_ddl(&sql);

            if record_history.unwrap_or(true) {
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
                let config_store = state.config_store.clone();
                tokio::spawn(async move {
                    if let Err(e) = config_store.add_to_history(&history_entry).await {
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
/// Instead of delegating to `execute_query` (which builds a row-based
/// `QueryResult`) and transposing it afterwards, this command inlines the same
/// safety-limit / history / event logic and asks the driver for columnar
/// results directly. Drivers that can decode into columns (Postgres) never
/// materialize `Vec<Row>` at all; the rest fall back to the trait default,
/// which transposes for them.
#[tauri::command]
#[instrument(skip(state, connection_id, sql, query_id), fields(query_id, row_count))]
pub async fn execute_query_columnar(
    state: State<'_, AppState>,
    connection_id: Uuid,
    sql: String,
    query_id: Option<Uuid>,
    record_history: Option<bool>,
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
        result = conn.execute_columnar_tracked(&effective_sql, &query_id) => result,
    };
    state.stream_cancellers.remove(&query_id);

    match outcome {
        Ok(mut result) => {
            result.query_id = query_id;
            result.execution_time_ms = start.elapsed().as_millis() as u64;

            let row_count = result.row_count as u64;
            tracing::Span::current().record("row_count", row_count);

            let is_ddl = schema_cache::is_ddl(&sql);

            if record_history.unwrap_or(true) {
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
                let config_store = state.config_store.clone();
                tokio::spawn(async move {
                    if let Err(e) = config_store.add_to_history(&history_entry).await {
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
    // Abandoning the wait is what frees the tab; the driver call additionally
    // stops the query server-side for drivers that can target it by id, and
    // is a no-op for the rest.
    let live = cancel_tracked_query(&state.stream_cancellers, &query_id, || async {
        conn.cancel_query(&query_id).await
    })
    .await;
    // A query that had already finished cancels nothing, and saying otherwise
    // would retract a result the UI is showing.
    if live {
        state
            .event_bus
            .emit(AppEvent::QueryCancelled { query_id });
    }
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

/// What one statement in a batch did: the rows it affected, or why it failed.
/// Exactly one of the two is set.
#[derive(Serialize)]
pub struct StatementOutcome {
    pub affected_rows: Option<u64>,
    pub error: Option<String>,
}

/// A whole batch's result without any of its rows. `outcomes` stays aligned
/// with the statements that produced it, index for index.
#[derive(Serialize)]
pub struct BatchSummary {
    pub outcomes: Vec<StatementOutcome>,
    pub total_affected: u64,
    pub failed: u32,
}

/// Roll per-statement outcomes into the batch totals.
///
/// A failed statement doesn't discount the ones that succeeded — the rows
/// those wrote are really in the table — so `total_affected` sums what landed
/// while `failed` counts what didn't. An outcome with neither an error nor a
/// count is a driver saying it can't know the count, which contributes
/// nothing to either total.
pub(crate) fn summarize(outcomes: Vec<StatementOutcome>) -> BatchSummary {
    let total_affected = outcomes.iter().filter_map(|o| o.affected_rows).sum();
    let failed = outcomes.iter().filter(|o| o.error.is_some()).count() as u32;
    BatchSummary {
        outcomes,
        total_affected,
        failed,
    }
}

/// Statements per progress window when the caller doesn't pick one.
pub(crate) const DEFAULT_BATCH_WINDOW: usize = 200;

/// Largest window a caller may ask for. The value arrives over IPC and the CSV
/// import sizes buffers from it, where a wild number would allocate eagerly and
/// abort the process on a failed allocation instead of returning an error.
/// Clamping is lossless in practice: a window only sets how often progress is
/// reported, so anything past a few hundred already means "report once".
pub(crate) const MAX_BATCH_WINDOW: usize = 10_000;

/// Run `statements` in order, appending one outcome per statement and emitting
/// a `QueryProgress` event every `window` statements.
///
/// Deliberately sequential, with no concurrency at all. The callers are
/// imports, whose statements are ordered — the `CREATE TABLE` must land before
/// the `INSERT`s, and rows arrive in file order — so overlapping them would
/// trade correctness for throughput. `window` only sets how often progress is
/// reported, never how much runs at once.
///
/// A failing statement doesn't stop the run: its error is recorded in place and
/// the rest still go, matching `execute_batch` and letting the caller report
/// how many of the import's statements got through.
///
/// `outcomes` carries in and out so a caller streaming a file can hand over one
/// window at a time and still report a single running total.
pub(crate) async fn run_statements_windowed(
    conn: &dyn DatabaseConnection,
    event_bus: &EventBus,
    batch_id: Uuid,
    start: std::time::Instant,
    window: usize,
    statements: &[String],
    outcomes: &mut Vec<StatementOutcome>,
) {
    for chunk in statements.chunks(window) {
        for sql in chunk {
            // A SELECT inside a batch keeps the same cap it gets on its own,
            // so one unbounded read can't drag the whole batch down.
            let effective_sql = if needs_safety_limit(sql) {
                apply_safety_limit(sql)
            } else {
                sql.clone()
            };
            outcomes.push(match conn.execute(&effective_sql).await {
                Ok(result) => StatementOutcome {
                    affected_rows: result.affected_rows,
                    error: None,
                },
                Err(e) => StatementOutcome {
                    affected_rows: None,
                    error: Some(IpcError::from(e).message),
                },
            });
        }
        event_bus.emit(AppEvent::QueryProgress {
            query_id: batch_id,
            rows_fetched: outcomes.len() as u64,
            elapsed_ms: start.elapsed().as_millis() as u64,
        });
    }
}

/// Run `statements` and return only their counts, reporting progress as it goes.
///
/// The counts-only reply is the point: `execute_batch` returns a full
/// `QueryResult` envelope per statement, so a 20k-row CSV import serializes
/// 400 of them across IPC to display a single success number.
///
/// See `run_statements_windowed` for the ordering and failure guarantees.
#[tauri::command]
pub async fn execute_batch_summary(
    state: State<'_, AppState>,
    connection_id: Uuid,
    statements: Vec<String>,
    window: Option<usize>,
) -> Result<BatchSummary, IpcError> {
    let conn = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        Arc::clone(&active.connection)
    };

    let has_ddl = statements.iter().any(|sql| schema_cache::is_ddl(sql));

    let mut outcomes = Vec::with_capacity(statements.len());
    run_statements_windowed(
        conn.as_ref(),
        &state.event_bus,
        Uuid::new_v4(),
        std::time::Instant::now(),
        window.unwrap_or(DEFAULT_BATCH_WINDOW).clamp(1, MAX_BATCH_WINDOW),
        &statements,
        &mut outcomes,
    )
    .await;

    if has_ddl {
        state.schema_cache.invalidate_connection(&connection_id);
    }

    Ok(summarize(outcomes))
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
            stream = conn.execute_stream_tracked(&effective_sql, chunk_size, &query_id) => stream,
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
        apply_safety_limit, cancel_tracked_query, needs_safety_limit, register_canceller,
        signal_cancel, summarize, Cancellers, StatementOutcome, SAFETY_ROW_LIMIT,
    };
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use uuid::Uuid;

    fn ok(affected: u64) -> StatementOutcome {
        StatementOutcome {
            affected_rows: Some(affected),
            error: None,
        }
    }

    fn failed(message: &str) -> StatementOutcome {
        StatementOutcome {
            affected_rows: None,
            error: Some(message.to_string()),
        }
    }

    #[test]
    fn an_empty_batch_summarizes_to_zero() {
        let summary = summarize(vec![]);

        assert!(summary.outcomes.is_empty());
        assert_eq!(summary.total_affected, 0);
        assert_eq!(summary.failed, 0);
    }

    #[test]
    fn totals_the_affected_rows_of_every_successful_statement() {
        let summary = summarize(vec![ok(50), ok(50), ok(37)]);

        assert_eq!(summary.total_affected, 137);
        assert_eq!(summary.failed, 0);
        assert_eq!(summary.outcomes.len(), 3);
    }

    #[test]
    fn counts_failures_and_still_totals_the_statements_that_landed() {
        // A failed statement must not zero the import counter: the rows the
        // surviving INSERTs wrote are really in the table.
        let summary = summarize(vec![ok(50), failed("duplicate key"), ok(20)]);

        assert_eq!(summary.total_affected, 70);
        assert_eq!(summary.failed, 1);
    }

    #[test]
    fn a_statement_whose_affected_count_is_unknown_contributes_nothing_but_is_not_a_failure() {
        // Drivers report None where the count is genuinely unknowable; that is
        // silence about the count, not an error.
        let summary = summarize(vec![
            ok(10),
            StatementOutcome {
                affected_rows: None,
                error: None,
            },
        ]);

        assert_eq!(summary.total_affected, 10);
        assert_eq!(summary.failed, 0);
    }

    #[test]
    fn preserves_outcome_order_so_each_entry_maps_back_to_its_statement() {
        let summary = summarize(vec![ok(1), failed("boom"), ok(3)]);

        assert_eq!(summary.outcomes[0].affected_rows, Some(1));
        assert_eq!(summary.outcomes[1].error.as_deref(), Some("boom"));
        assert_eq!(summary.outcomes[2].affected_rows, Some(3));
    }

    #[test]
    fn a_wholly_failed_batch_reports_every_statement_as_failed() {
        let summary = summarize(vec![failed("a"), failed("b")]);

        assert_eq!(summary.total_affected, 0);
        assert_eq!(summary.failed, 2);
    }

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

    #[tokio::test]
    async fn driver_cancel_runs_before_the_local_waiter_is_woken() {
        // Waking the waiter first drops the query future — and with it the
        // driver's pid registration — so the driver must be asked to cancel
        // while the local signal is still unsent.
        let cancellers = Cancellers::new();
        let query_id = Uuid::new_v4();
        let rx = register_canceller(&cancellers, query_id);

        let signalled_during_driver_cancel = Arc::new(AtomicBool::new(false));
        let observed = Arc::clone(&signalled_during_driver_cancel);
        let observed_rx = rx.clone();
        let live = cancel_tracked_query(&cancellers, &query_id, || async move {
            observed.store(*observed_rx.borrow(), Ordering::SeqCst);
            Ok(())
        })
        .await;

        assert!(live);
        assert!(!signalled_during_driver_cancel.load(Ordering::SeqCst));
        assert!(*rx.borrow());
        assert!(cancellers.is_empty());
    }

    #[tokio::test]
    async fn cancel_without_registration_never_reaches_the_driver() {
        let cancellers = Cancellers::new();
        let driver_called = Arc::new(AtomicBool::new(false));
        let called = Arc::clone(&driver_called);

        let live = cancel_tracked_query(&cancellers, &Uuid::new_v4(), || async move {
            called.store(true, Ordering::SeqCst);
            Ok(())
        })
        .await;

        assert!(!live);
        assert!(!driver_called.load(Ordering::SeqCst));
    }

    #[tokio::test(start_paused = true)]
    async fn slow_driver_cancel_does_not_stall_the_local_cancel() {
        // A saturated Postgres pool can make the driver cancel wait up to its
        // 10s acquire timeout. The local waiter (what frees the tab) must be
        // woken after the bounded driver window, not after the full stall.
        let cancellers = Cancellers::new();
        let query_id = Uuid::new_v4();
        let rx = register_canceller(&cancellers, query_id);

        let start = tokio::time::Instant::now();
        let live = cancel_tracked_query(&cancellers, &query_id, || async {
            tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            Ok(())
        })
        .await;

        assert!(live);
        assert!(*rx.borrow());
        assert!(start.elapsed() < std::time::Duration::from_secs(3));
    }

    #[tokio::test]
    async fn driver_cancel_failure_still_wakes_the_local_waiter() {
        let cancellers = Cancellers::new();
        let query_id = Uuid::new_v4();
        let rx = register_canceller(&cancellers, query_id);

        let live = cancel_tracked_query(&cancellers, &query_id, || async {
            Err(purrql_core::error::PurrqlError::QueryExecution(
                "not supported".into(),
            ))
        })
        .await;

        assert!(live);
        assert!(*rx.borrow());
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

    #[test]
    fn limit_inside_a_subquery_does_not_bound_the_outer_select() {
        // The subquery's LIMIT bounds only the IN-list; the outer SELECT can
        // still return every row of `huge`, so it must keep the safety cap.
        let sql = "SELECT * FROM huge WHERE id IN (SELECT id FROM small ORDER BY ts LIMIT 5)";
        assert!(needs_safety_limit(sql));
        assert_eq!(
            apply_safety_limit(sql),
            format!("{}\nLIMIT {}", sql, SAFETY_ROW_LIMIT)
        );
    }

    #[test]
    fn limit_inside_a_cte_body_does_not_bound_the_outer_select() {
        assert!(needs_safety_limit(
            "WITH recent AS (SELECT * FROM events ORDER BY ts DESC LIMIT 10) \
             SELECT * FROM huge JOIN recent USING (id)"
        ));
    }

    #[test]
    fn limit_after_a_closed_subquery_still_bounds_the_outer_select() {
        // Depth returns to 0 after the subquery closes, so this trailing
        // LIMIT is the outer query's own and suppresses the cap.
        assert!(!needs_safety_limit(
            "SELECT * FROM huge WHERE id IN (SELECT id FROM small LIMIT 5) LIMIT 100"
        ));
        assert!(!needs_safety_limit("SELECT * FROM users LIMIT 10"));
    }

    #[test]
    fn fetch_first_rows_only_bounds_the_query_but_a_bare_fetch_does_not() {
        // The standard row-limiting forms.
        assert!(!needs_safety_limit(
            "SELECT * FROM t FETCH FIRST 10 ROWS ONLY"
        ));
        assert!(!needs_safety_limit(
            "SELECT * FROM t OFFSET 20 ROWS FETCH NEXT 10 ROWS ONLY"
        ));
        // A FETCH not followed by FIRST/NEXT limits nothing (e.g. the cursor
        // statement), so it must not suppress the cap.
        assert!(needs_safety_limit("SELECT fetch FROM t"));
        assert!(needs_safety_limit("SELECT * FROM t WHERE op = fetch"));
    }

    #[test]
    fn fetch_first_inside_a_subquery_does_not_bound_the_outer_select() {
        assert!(needs_safety_limit(
            "SELECT * FROM huge WHERE id IN (SELECT id FROM small FETCH FIRST 5 ROWS ONLY)"
        ));
    }

    #[test]
    fn parens_inside_a_string_literal_do_not_corrupt_the_depth() {
        // The unbalanced `(` and `)` are literal text. If they shifted the
        // depth, the real top-level LIMIT would be misread as nested (and a
        // second LIMIT appended, producing invalid SQL).
        assert!(!needs_safety_limit(
            "SELECT * FROM t WHERE label = 'a )( b' LIMIT 10"
        ));
        assert!(!needs_safety_limit(
            "SELECT * FROM t WHERE label = 'it''s ((' LIMIT 10"
        ));
        // Symmetrically, a literal `)` must not close a real subquery early
        // and promote its nested LIMIT to top level.
        assert!(needs_safety_limit(
            "SELECT * FROM huge WHERE id IN (SELECT id FROM small WHERE tag = ')' LIMIT 5)"
        ));
    }

    #[test]
    fn quoted_identifier_parens_do_not_corrupt_the_depth() {
        assert!(!needs_safety_limit(
            r#"SELECT "weird)(name" FROM t LIMIT 10"#
        ));
    }

    #[test]
    fn backslash_escaped_quote_falls_back_to_conservative_detection() {
        // MySQL's `\'` escape isn't modeled by the tokenizer: it closes the
        // literal at the `\'`, reads the literal `(` as a real paren, and tags
        // the genuine top-level LIMIT at depth 1. The scan ends unbalanced,
        // which must disable depth filtering — skipping the safety limit is
        // safe, appending a second LIMIT to valid SQL is not.
        assert!(!needs_safety_limit(
            r"SELECT * FROM t WHERE label = 'a\'( b' LIMIT 5"
        ));
    }

    #[test]
    fn dollar_quoted_parens_fall_back_to_conservative_detection() {
        // Postgres dollar-quoting isn't modeled either: the `(` inside
        // `$$)($$` counts as a real paren and the scan ends at depth 1,
        // hiding the genuine top-level LIMIT.
        assert!(!needs_safety_limit("SELECT $$)($$ AS v FROM t LIMIT 3"));
    }
}
