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

    #[cfg(test)]
    fn with_ttl(ttl: Duration) -> Self {
        Self {
            tables: DashMap::new(),
            structures: DashMap::new(),
            ttl,
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

    /// Returns `(cached_value, needs_refresh)`.
    ///
    /// The caller receives stale-but-valid data while `needs_refresh` is `true`,
    /// allowing a background task to repopulate the cache before the TTL expires.
    pub fn get_structure(
        &self,
        conn_id: &Uuid,
        table: &TableRef,
    ) -> (Option<TableStructure>, bool) {
        let key = (*conn_id, table.clone());
        match self.structures.get(&key) {
            Some(entry) => {
                let elapsed = entry.1.elapsed();
                if elapsed < self.ttl {
                    // Signal refresh when 80% of TTL has elapsed
                    let needs_refresh = elapsed > (self.ttl * 4 / 5);
                    (Some(entry.0.clone()), needs_refresh)
                } else {
                    drop(entry);
                    self.structures.remove(&key);
                    (None, true)
                }
            }
            None => (None, true),
        }
    }

    pub fn set_structure(&self, conn_id: Uuid, table: TableRef, structure: TableStructure) {
        let key = (conn_id, table);
        self.structures
            .insert(key.clone(), (structure, Instant::now()));
        self.evict_oldest_structures_for_connection(&key.0);
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

    /// Evict the oldest structure entries when a single connection exceeds the cap.
    fn evict_oldest_structures_for_connection(&self, connection_id: &Uuid) {
        let conn_entries: Vec<_> = self
            .structures
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
                self.structures.remove(old_key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use purrql_core::models::schema::{ColumnInfo, TableRef, TableStructure};
    use purrql_core::models::types::DataType;
    use std::thread::sleep;

    fn table_ref(name: &str) -> TableRef {
        TableRef {
            database: Some("db".to_string()),
            schema: Some("public".to_string()),
            table: name.to_string(),
        }
    }

    fn structure(name: &str) -> TableStructure {
        TableStructure {
            table_ref: table_ref(name),
            columns: vec![ColumnInfo {
                name: "id".to_string(),
                data_type: "int4".to_string(),
                mapped_type: DataType::Integer,
                nullable: false,
                default_value: None,
                is_primary_key: true,
                ordinal_position: 1,
                comment: None,
            }],
            primary_key: None,
            indexes: vec![],
            foreign_keys: vec![],
            constraints: vec![],
            comment: None,
        }
    }

    #[test]
    fn fresh_structure_hit_returns_some_and_no_refresh() {
        let cache = SchemaCache::with_ttl(Duration::from_secs(300));
        let conn_id = Uuid::new_v4();
        let tbl = table_ref("users");
        cache.set_structure(conn_id, tbl.clone(), structure("users"));

        let (result, needs_refresh) = cache.get_structure(&conn_id, &tbl);
        assert!(result.is_some());
        assert!(!needs_refresh);
    }

    #[test]
    fn stale_but_alive_structure_returns_some_and_needs_refresh() {
        // ttl long enough that sleeping past 4/5 of it triggers the stale window
        // while staying comfortably under the full ttl, even under scheduler jitter.
        let ttl = Duration::from_millis(300);
        let cache = SchemaCache::with_ttl(ttl);
        let conn_id = Uuid::new_v4();
        let tbl = table_ref("users");
        cache.set_structure(conn_id, tbl.clone(), structure("users"));

        sleep(Duration::from_millis(260));

        let (result, needs_refresh) = cache.get_structure(&conn_id, &tbl);
        assert!(result.is_some());
        assert!(needs_refresh);
    }

    #[test]
    fn expired_structure_returns_none_and_is_removed() {
        let ttl = Duration::from_millis(20);
        let cache = SchemaCache::with_ttl(ttl);
        let conn_id = Uuid::new_v4();
        let tbl = table_ref("users");
        cache.set_structure(conn_id, tbl.clone(), structure("users"));

        sleep(Duration::from_millis(80));

        let (result, needs_refresh) = cache.get_structure(&conn_id, &tbl);
        assert!(result.is_none());
        assert!(needs_refresh);
        assert!(cache.structures.is_empty());
    }

    #[test]
    fn invalidate_connection_clears_structures() {
        let cache = SchemaCache::with_ttl(Duration::from_secs(300));
        let conn_id = Uuid::new_v4();
        let tbl = table_ref("users");
        cache.set_structure(conn_id, tbl.clone(), structure("users"));

        cache.invalidate_connection(&conn_id);

        let (result, needs_refresh) = cache.get_structure(&conn_id, &tbl);
        assert!(result.is_none());
        assert!(needs_refresh);
    }

    #[test]
    fn miss_returns_none_and_needs_refresh() {
        let cache = SchemaCache::with_ttl(Duration::from_secs(300));
        let conn_id = Uuid::new_v4();
        let tbl = table_ref("users");

        let (result, needs_refresh) = cache.get_structure(&conn_id, &tbl);
        assert!(result.is_none());
        assert!(needs_refresh);
    }

    #[test]
    fn per_connection_cap_evicts_oldest_structures() {
        let cache = SchemaCache::with_ttl(Duration::from_secs(300));
        let conn_id = Uuid::new_v4();

        for i in 0..(MAX_ENTRIES_PER_CONNECTION + 5) {
            let name = format!("table_{i}");
            cache.set_structure(conn_id, table_ref(&name), structure(&name));
            // Ensure distinct Instant ordering across inserts.
            sleep(Duration::from_micros(50));
        }

        let remaining = cache
            .structures
            .iter()
            .filter(|e| e.key().0 == conn_id)
            .count();
        assert_eq!(remaining, MAX_ENTRIES_PER_CONNECTION);

        // The oldest entry should have been evicted.
        let (oldest, _) = cache.get_structure(&conn_id, &table_ref("table_0"));
        assert!(oldest.is_none());

        // The newest entry should still be present.
        let last_name = format!("table_{}", MAX_ENTRIES_PER_CONNECTION + 4);
        let (newest, _) = cache.get_structure(&conn_id, &table_ref(&last_name));
        assert!(newest.is_some());
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
