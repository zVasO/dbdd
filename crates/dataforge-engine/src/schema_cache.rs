use std::time::{Duration, Instant};

use dashmap::DashMap;
use uuid::Uuid;

use dataforge_core::models::schema::{TableInfo, TableRef, TableStructure};

const DEFAULT_TTL: Duration = Duration::from_secs(300);

type TableCacheKey = (Uuid, String, Option<String>);

pub struct SchemaCache {
    tables: DashMap<TableCacheKey, (Vec<TableInfo>, Instant)>,
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

    pub fn get_tables(
        &self,
        conn_id: &Uuid,
        db: &str,
        schema: Option<&str>,
    ) -> Option<Vec<TableInfo>> {
        let key = (*conn_id, db.to_string(), schema.map(|s| s.to_string()));
        self.tables.get(&key).and_then(|entry| {
            if entry.1.elapsed() < self.ttl {
                Some(entry.0.clone())
            } else {
                None
            }
        })
    }

    pub fn set_tables(
        &self,
        conn_id: Uuid,
        db: String,
        schema: Option<String>,
        tables: Vec<TableInfo>,
    ) {
        self.tables
            .insert((conn_id, db, schema), (tables, Instant::now()));
    }

    pub fn invalidate_connection(&self, conn_id: &Uuid) {
        self.tables.retain(|k, _| &k.0 != conn_id);
        self.structures.retain(|k, _| &k.0 != conn_id);
    }
}
