use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

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
