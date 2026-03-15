use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use uuid::Uuid;

use purrql_core::models::schema::{TableInfo, TableRef, TableStructure};

const DEFAULT_TTL: Duration = Duration::from_secs(300);
const MAX_ENTRIES_PER_CONNECTION: usize = 200;

type TableCacheKey = (Uuid, String, Option<String>);

pub struct SchemaCache {
    tables: DashMap<TableCacheKey, (Arc<Vec<TableInfo>>, Instant)>,
    structures: DashMap<(Uuid, TableRef), (TableStructure, Instant)>,
    ttl: Duration,
}

impl Default for SchemaCache {
    fn default() -> Self {
        Self::new()
    }
}

impl SchemaCache {
    pub fn new() -> Self {
        Self {
            tables: DashMap::new(),
            structures: DashMap::new(),
            ttl: DEFAULT_TTL,
        }
    }

    /// Returns `(cached_value, needs_refresh)`.
    ///
    /// The caller receives stale-but-valid data while `needs_refresh` is `true`,
    /// allowing a background task to repopulate the cache before the TTL expires.
    pub fn get_tables(
        &self,
        conn_id: &Uuid,
        db: &str,
        schema: Option<&str>,
    ) -> (Option<Arc<Vec<TableInfo>>>, bool) {
        let key = (*conn_id, db.to_string(), schema.map(|s| s.to_string()));
        match self.tables.get(&key) {
            Some(entry) => {
                let elapsed = entry.1.elapsed();
                if elapsed < self.ttl {
                    // Signal refresh when 80% of TTL has elapsed
                    let needs_refresh = elapsed > (self.ttl * 4 / 5);
                    (Some(Arc::clone(&entry.0)), needs_refresh)
                } else {
                    drop(entry);
                    self.tables.remove(&key);
                    (None, true)
                }
            }
            None => (None, true),
        }
    }

    pub fn set_tables(
        &self,
        conn_id: Uuid,
        db: String,
        schema: Option<String>,
        tables: Vec<TableInfo>,
    ) {
        let key = (conn_id, db, schema);
        self.tables
            .insert(key.clone(), (Arc::new(tables), Instant::now()));
        self.evict_oldest_for_connection(&key.0);
    }

    pub fn invalidate_connection(&self, conn_id: &Uuid) {
        self.tables.retain(|k, _| &k.0 != conn_id);
        self.structures.retain(|k, _| &k.0 != conn_id);
    }

    /// Remove all expired entries from both caches.
    /// Called periodically by a background task to prevent unbounded growth.
    pub fn evict_expired(&self) {
        let ttl = self.ttl;
        self.tables.retain(|_, (_, created)| created.elapsed() < ttl);
        self.structures.retain(|_, (_, created)| created.elapsed() < ttl);
    }

    /// Evict the oldest entries when a single connection exceeds the cap.
    fn evict_oldest_for_connection(&self, connection_id: &Uuid) {
        let conn_entries: Vec<_> = self
            .tables
            .iter()
            .filter(|e| &e.key().0 == connection_id)
            .map(|e| (e.key().clone(), e.value().1))
            .collect();

        if conn_entries.len() > MAX_ENTRIES_PER_CONNECTION {
            let mut sorted = conn_entries;
            sorted.sort_by_key(|(_, instant)| *instant);
            for (old_key, _) in sorted
                .iter()
                .take(sorted.len() - MAX_ENTRIES_PER_CONNECTION)
            {
                self.tables.remove(old_key);
            }
        }
    }
}

/// Returns `true` when the SQL statement is a DDL command that may
/// alter the database schema (CREATE, ALTER, DROP, TRUNCATE).
///
/// Uses case-insensitive byte comparison to avoid allocating a new String.
pub fn is_ddl(sql: &str) -> bool {
    let trimmed = sql.trim_start();
    trimmed.get(..6).map_or(false, |s| s.eq_ignore_ascii_case("CREATE"))
        || trimmed.get(..5).map_or(false, |s| s.eq_ignore_ascii_case("ALTER"))
        || trimmed.get(..4).map_or(false, |s| s.eq_ignore_ascii_case("DROP"))
        || trimmed.get(..8).map_or(false, |s| s.eq_ignore_ascii_case("TRUNCATE"))
}
