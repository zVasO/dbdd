use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use aes_gcm::{aead::KeyInit, Aes256Gcm};
use rusqlite::Connection;
use tracing::{debug, warn};
use uuid::Uuid;

use purrql_core::error::{PurrqlError, Result};
use purrql_core::models::connection::ConnectionConfig;
use purrql_core::models::connection::SavedConnection;
use purrql_core::models::query::{QueryHistoryEntry, QueryStatus};

use crate::crypto;

pub struct ConfigStore {
    conn: Arc<Mutex<Connection>>,
    cipher: Aes256Gcm,
    #[allow(dead_code)]
    app_data_dir: PathBuf,
}

impl ConfigStore {
    pub fn new(app_data_dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(app_data_dir)
            .map_err(|e| PurrqlError::Config(e.to_string()))?;

        let db_path = app_data_dir.join("purrql.db");
        let conn =
            Connection::open(db_path).map_err(|e| PurrqlError::Config(e.to_string()))?;

        crate::migrations::run_migrations(&conn)
            .map_err(|e| PurrqlError::Config(e.to_string()))?;

        let encryption_key = crypto::load_or_create_key(app_data_dir)?;
        let cipher = Aes256Gcm::new_from_slice(&encryption_key)
            .map_err(|e| PurrqlError::Config(format!("Cipher init error: {e}")))?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            cipher,
            app_data_dir: app_data_dir.to_path_buf(),
        })
    }

    pub async fn save_connection(&self, config: &ConnectionConfig) -> Result<()> {
        let config_json =
            serde_json::to_string(config).map_err(|e| PurrqlError::Serialization(e.to_string()))?;
        let now = chrono::Utc::now().to_rfc3339();
        let id = config.id.to_string();
        let conn = Arc::clone(&self.conn);

        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| PurrqlError::Internal(e.to_string()))?;
            conn.execute(
                "INSERT OR REPLACE INTO connections (id, config_json, created_at, sort_order) VALUES (?1, ?2, ?3, 0)",
                rusqlite::params![id, config_json, now],
            )
            .map_err(|e| PurrqlError::Config(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))?
    }

    pub async fn list_connections(&self) -> Result<Vec<SavedConnection>> {
        let conn = Arc::clone(&self.conn);

        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| PurrqlError::Internal(e.to_string()))?;
            let mut stmt = conn
                .prepare("SELECT config_json, created_at, last_used_at, sort_order FROM connections ORDER BY sort_order, created_at")
                .map_err(|e| PurrqlError::Config(e.to_string()))?;

            let rows = stmt
                .query_map([], |row| {
                    let config_json: String = row.get(0)?;
                    let created_at: String = row.get(1)?;
                    let last_used_at: Option<String> = row.get(2)?;
                    let sort_order: i32 = row.get(3)?;
                    Ok((config_json, created_at, last_used_at, sort_order))
                })
                .map_err(|e| PurrqlError::Config(e.to_string()))?;

            let mut connections = Vec::new();
            for row in rows {
                let (config_json, created_at, last_used_at, sort_order) =
                    row.map_err(|e| PurrqlError::Config(e.to_string()))?;
                let config: ConnectionConfig = serde_json::from_str(&config_json)
                    .map_err(|e| PurrqlError::Serialization(e.to_string()))?;
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
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))?
    }

    pub async fn delete_connection(&self, id: &Uuid) -> Result<()> {
        let conn = Arc::clone(&self.conn);
        let id = id.to_string();

        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| PurrqlError::Internal(e.to_string()))?;
            conn.execute(
                "DELETE FROM connections WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| PurrqlError::Config(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))?
    }

    /// Store a password securely. Tries OS keyring first, falls back to AES-256-GCM encrypted SQLite.
    pub async fn store_password(&self, config_id: &Uuid, password: &str) -> Result<()> {
        // Always store in encrypted SQLite (reliable fallback)
        self.store_password_encrypted(config_id, password).await?;

        // Also try OS keyring on a blocking thread (Keychain can be slow on macOS)
        let service = format!("purrql-{}", config_id);
        let pw = password.to_owned();
        let _ = tokio::task::spawn_blocking(move || {
            match keyring::Entry::new(&service, "password") {
                Ok(entry) => match entry.set_password(&pw) {
                    Ok(()) => debug!("Password stored in OS keyring"),
                    Err(e) => warn!("OS keyring store failed (using encrypted fallback): {e}"),
                },
                Err(e) => warn!("OS keyring init failed (using encrypted fallback): {e}"),
            }
        });

        Ok(())
    }

    /// Retrieve a stored password. Tries OS keyring first, falls back to encrypted SQLite.
    pub async fn get_password(&self, config_id: &Uuid) -> Result<Option<String>> {
        // Try OS keyring first on a blocking thread
        let service = format!("purrql-{}", config_id);
        let keyring_result = tokio::task::spawn_blocking(move || {
            match keyring::Entry::new(&service, "password") {
                Ok(entry) => match entry.get_password() {
                    Ok(pw) => {
                        debug!("Password retrieved from OS keyring");
                        Some(pw)
                    }
                    Err(keyring::Error::NoEntry) => {
                        debug!("No password in OS keyring, trying encrypted store");
                        None
                    }
                    Err(e) => {
                        warn!("OS keyring retrieval failed: {e}, trying encrypted store");
                        None
                    }
                },
                Err(e) => {
                    warn!("OS keyring init failed: {e}, trying encrypted store");
                    None
                }
            }
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))?;

        if let Some(pw) = keyring_result {
            return Ok(Some(pw));
        }

        // Fallback to encrypted SQLite
        self.get_password_encrypted(config_id).await
    }

    async fn store_password_encrypted(&self, config_id: &Uuid, password: &str) -> Result<()> {
        let (ciphertext, nonce) = crypto::encrypt(&self.cipher, password)?;
        let conn = Arc::clone(&self.conn);
        let config_id = config_id.to_string();

        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| PurrqlError::Internal(e.to_string()))?;
            conn.execute(
                "INSERT OR REPLACE INTO encrypted_passwords (connection_id, ciphertext, nonce) VALUES (?1, ?2, ?3)",
                rusqlite::params![config_id, ciphertext, nonce],
            ).map_err(|e| PurrqlError::Config(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))?
    }

    async fn get_password_encrypted(&self, config_id: &Uuid) -> Result<Option<String>> {
        let conn = Arc::clone(&self.conn);
        let config_id_str = config_id.to_string();

        // Fetch ciphertext/nonce on blocking thread, decrypt on async side
        let encrypted = tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| PurrqlError::Internal(e.to_string()))?;
            let mut stmt = conn.prepare(
                "SELECT ciphertext, nonce FROM encrypted_passwords WHERE connection_id = ?1"
            ).map_err(|e| PurrqlError::Config(e.to_string()))?;

            let result = stmt.query_row(
                rusqlite::params![config_id_str],
                |row| {
                    let ciphertext: String = row.get(0)?;
                    let nonce: String = row.get(1)?;
                    Ok((ciphertext, nonce))
                },
            );

            match result {
                Ok(pair) => Ok(Some(pair)),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
                Err(e) => Err(PurrqlError::Config(e.to_string())),
            }
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))??;

        match encrypted {
            Some((ciphertext, nonce)) => {
                let password = crypto::decrypt(&self.cipher, &ciphertext, &nonce)?;
                debug!("Password retrieved from encrypted store for {}", config_id);
                Ok(Some(password))
            }
            None => Ok(None),
        }
    }

    pub async fn add_to_history(&self, entry: &QueryHistoryEntry) -> Result<()> {
        let conn = Arc::clone(&self.conn);
        let id = entry.id.to_string();
        let connection_id = entry.connection_id.to_string();
        let sql = entry.sql.clone();
        let executed_at = entry.executed_at.to_rfc3339();
        let duration_ms = entry.duration_ms as i64;
        let row_count = entry.row_count.map(|n| n as i64);
        let status = match entry.status {
            QueryStatus::Success => "success",
            QueryStatus::Error => "error",
            QueryStatus::Cancelled => "cancelled",
        }
        .to_string();
        let error_message = entry.error_message.clone();

        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| PurrqlError::Internal(e.to_string()))?;
            conn.execute(
                "INSERT INTO query_history (id, connection_id, sql, executed_at, duration_ms, row_count, status, error_message) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    id,
                    connection_id,
                    sql,
                    executed_at,
                    duration_ms,
                    row_count,
                    status,
                    error_message,
                ],
            )
            .map_err(|e| PurrqlError::Config(e.to_string()))?;
            Ok(())
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))?
    }

    pub async fn get_history(
        &self,
        connection_id: &Uuid,
        limit: u32,
    ) -> Result<Vec<QueryHistoryEntry>> {
        let conn = Arc::clone(&self.conn);
        let connection_id = connection_id.to_string();

        tokio::task::spawn_blocking(move || {
            let conn = conn.lock().map_err(|e| PurrqlError::Internal(e.to_string()))?;
            let mut stmt = conn
                .prepare(
                    "SELECT id, connection_id, sql, executed_at, duration_ms, row_count, status, error_message \
                     FROM query_history WHERE connection_id = ?1 ORDER BY executed_at DESC LIMIT ?2",
                )
                .map_err(|e| PurrqlError::Config(e.to_string()))?;

            let rows = stmt
                .query_map(rusqlite::params![connection_id, limit], |row| {
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
                .map_err(|e| PurrqlError::Config(e.to_string()))?;

            let mut entries = Vec::new();
            for row in rows {
                let (id, conn_id, sql, executed_at, duration_ms, row_count, status, error_message) =
                    row.map_err(|e| PurrqlError::Config(e.to_string()))?;
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
        })
        .await
        .map_err(|e| PurrqlError::Internal(e.to_string()))?
    }
}
