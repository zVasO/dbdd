use std::path::Path;
use std::sync::Mutex;

use rusqlite::Connection;
use uuid::Uuid;

use dataforge_core::error::{DataForgeError, Result};
use dataforge_core::models::connection::ConnectionConfig;
use dataforge_core::models::connection::SavedConnection;
use dataforge_core::models::query::{QueryHistoryEntry, QueryStatus};

pub struct ConfigStore {
    conn: Mutex<Connection>,
}

impl ConfigStore {
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| DataForgeError::Config(e.to_string()))?;

        let db_path = app_data_dir.join("dataforge.db");
        let conn =
            Connection::open(db_path).map_err(|e| DataForgeError::Config(e.to_string()))?;

        crate::migrations::run_migrations(&conn)
            .map_err(|e| DataForgeError::Config(e.to_string()))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub async fn save_connection(&self, config: &ConnectionConfig) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| DataForgeError::Internal(e.to_string()))?;
        let config_json =
            serde_json::to_string(config).map_err(|e| DataForgeError::Serialization(e.to_string()))?;
        let now = chrono::Utc::now().to_rfc3339();
        let id = config.id.to_string();

        conn.execute(
            "INSERT OR REPLACE INTO connections (id, config_json, created_at, sort_order) VALUES (?1, ?2, ?3, 0)",
            rusqlite::params![id, config_json, now],
        )
        .map_err(|e| DataForgeError::Config(e.to_string()))?;

        Ok(())
    }

    pub async fn list_connections(&self) -> Result<Vec<SavedConnection>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| DataForgeError::Internal(e.to_string()))?;
        let mut stmt = conn
            .prepare("SELECT config_json, created_at, last_used_at, sort_order FROM connections ORDER BY sort_order, created_at")
            .map_err(|e| DataForgeError::Config(e.to_string()))?;

        let rows = stmt
            .query_map([], |row| {
                let config_json: String = row.get(0)?;
                let created_at: String = row.get(1)?;
                let last_used_at: Option<String> = row.get(2)?;
                let sort_order: i32 = row.get(3)?;
                Ok((config_json, created_at, last_used_at, sort_order))
            })
            .map_err(|e| DataForgeError::Config(e.to_string()))?;

        let mut connections = Vec::new();
        for row in rows {
            let (config_json, created_at, last_used_at, sort_order) =
                row.map_err(|e| DataForgeError::Config(e.to_string()))?;
            let config: ConnectionConfig = serde_json::from_str(&config_json)
                .map_err(|e| DataForgeError::Serialization(e.to_string()))?;
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at)
                .map(|dt| dt.with_timezone(&chrono::Utc))
                .unwrap_or_else(|_| chrono::Utc::now());
            let last_used_at = last_used_at.and_then(|s| {
                chrono::DateTime::parse_from_rfc3339(&s)
                    .ok()
                    .map(|dt| dt.with_timezone(&chrono::Utc))
            });
            connections.push(SavedConnection {
                config,
                created_at,
                last_used_at,
                sort_order,
            });
        }
        Ok(connections)
    }

    pub async fn delete_connection(&self, id: &Uuid) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| DataForgeError::Internal(e.to_string()))?;
        conn.execute(
            "DELETE FROM connections WHERE id = ?1",
            rusqlite::params![id.to_string()],
        )
        .map_err(|e| DataForgeError::Config(e.to_string()))?;
        Ok(())
    }

    pub fn store_password(&self, config_id: &Uuid, password: &str) -> Result<()> {
        let service = format!("dataforge-{}", config_id);
        let entry = keyring::Entry::new(&service, "password")
            .map_err(|e| DataForgeError::Config(e.to_string()))?;
        entry
            .set_password(password)
            .map_err(|e| DataForgeError::Config(e.to_string()))?;
        Ok(())
    }

    pub fn get_password(&self, config_id: &Uuid) -> Result<Option<String>> {
        let service = format!("dataforge-{}", config_id);
        let entry = keyring::Entry::new(&service, "password")
            .map_err(|e| DataForgeError::Config(e.to_string()))?;
        match entry.get_password() {
            Ok(pw) => Ok(Some(pw)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(DataForgeError::Config(e.to_string())),
        }
    }

    pub async fn add_to_history(&self, entry: &QueryHistoryEntry) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| DataForgeError::Internal(e.to_string()))?;
        let status = match entry.status {
            QueryStatus::Success => "success",
            QueryStatus::Error => "error",
            QueryStatus::Cancelled => "cancelled",
        };
        conn.execute(
            "INSERT INTO query_history (id, connection_id, sql, executed_at, duration_ms, row_count, status, error_message) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                entry.id.to_string(),
                entry.connection_id.to_string(),
                entry.sql,
                entry.executed_at.to_rfc3339(),
                entry.duration_ms as i64,
                entry.row_count.map(|n| n as i64),
                status,
                entry.error_message,
            ],
        )
        .map_err(|e| DataForgeError::Config(e.to_string()))?;
        Ok(())
    }

    pub async fn get_history(
        &self,
        connection_id: &Uuid,
        limit: u32,
    ) -> Result<Vec<QueryHistoryEntry>> {
        let conn = self
            .conn
            .lock()
            .map_err(|e| DataForgeError::Internal(e.to_string()))?;
        let mut stmt = conn
            .prepare(
                "SELECT id, connection_id, sql, executed_at, duration_ms, row_count, status, error_message \
                 FROM query_history WHERE connection_id = ?1 ORDER BY executed_at DESC LIMIT ?2",
            )
            .map_err(|e| DataForgeError::Config(e.to_string()))?;

        let rows = stmt
            .query_map(rusqlite::params![connection_id.to_string(), limit], |row| {
                let id: String = row.get(0)?;
                let connection_id: String = row.get(1)?;
                let sql: String = row.get(2)?;
                let executed_at: String = row.get(3)?;
                let duration_ms: i64 = row.get(4)?;
                let row_count: Option<i64> = row.get(5)?;
                let status: String = row.get(6)?;
                let error_message: Option<String> = row.get(7)?;
                Ok((
                    id,
                    connection_id,
                    sql,
                    executed_at,
                    duration_ms,
                    row_count,
                    status,
                    error_message,
                ))
            })
            .map_err(|e| DataForgeError::Config(e.to_string()))?;

        let mut entries = Vec::new();
        for row in rows {
            let (id, conn_id, sql, executed_at, duration_ms, row_count, status, error_message) =
                row.map_err(|e| DataForgeError::Config(e.to_string()))?;
            entries.push(QueryHistoryEntry {
                id: Uuid::parse_str(&id).unwrap_or_else(|_| Uuid::new_v4()),
                connection_id: Uuid::parse_str(&conn_id).unwrap_or_else(|_| Uuid::new_v4()),
                sql,
                executed_at: chrono::DateTime::parse_from_rfc3339(&executed_at)
                    .map(|dt| dt.with_timezone(&chrono::Utc))
                    .unwrap_or_else(|_| chrono::Utc::now()),
                duration_ms: duration_ms as u64,
                row_count: row_count.map(|n| n as u64),
                status: match status.as_str() {
                    "success" => QueryStatus::Success,
                    "error" => QueryStatus::Error,
                    "cancelled" => QueryStatus::Cancelled,
                    _ => QueryStatus::Error,
                },
                error_message,
            });
        }
        Ok(entries)
    }
}
