use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

/// Truncate SQL for safe inclusion in events (avoids leaking credentials in DDL).
/// Uses `floor_char_boundary` logic to avoid splitting multi-byte UTF-8 characters.
fn truncate_sql(sql: &str, max_len: usize) -> String {
    if sql.len() <= max_len {
        sql.to_string()
    } else {
        // Find the last valid char boundary at or before max_len
        let mut end = max_len;
        while end > 0 && !sql.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}... ({} chars total)", &sql[..end], sql.chars().count())
    }
}

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "event_type", content = "payload")]
pub enum AppEvent {
    ConnectionEstablished { connection_id: Uuid },
    ConnectionClosed { connection_id: Uuid },
    ConnectionError { connection_id: Uuid, error: String },
    QueryStarted { query_id: Uuid, sql: String },
    QueryProgress { query_id: Uuid, rows_fetched: u64, elapsed_ms: u64 },
    QueryCompleted { query_id: Uuid, row_count: u64, elapsed_ms: u64 },
    QueryError { query_id: Uuid, error: String },
    QueryCancelled { query_id: Uuid },
}

impl AppEvent {
    /// Create a QueryStarted event with SQL truncated for safety.
    pub fn query_started(query_id: Uuid, sql: &str) -> Self {
        Self::QueryStarted {
            query_id,
            sql: truncate_sql(sql, 200),
        }
    }
}

pub struct EventBus {
    app_handle: AppHandle,
}

impl EventBus {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub fn emit(&self, event: AppEvent) {
        let _ = self.app_handle.emit("app-event", &event);
    }
}
