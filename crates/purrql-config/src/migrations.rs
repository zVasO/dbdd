use rusqlite::Connection;

pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    // Enable WAL mode for better concurrent read performance and reduced lock contention.
    // NORMAL synchronous is safe with WAL and reduces fsync overhead.
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        PRAGMA busy_timeout=5000;"
    )?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS connections (
            id TEXT PRIMARY KEY,
            config_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_used_at TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS query_history (
            id TEXT PRIMARY KEY,
            connection_id TEXT NOT NULL,
            sql TEXT NOT NULL,
            executed_at TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            row_count INTEGER,
            status TEXT NOT NULL,
            error_message TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_query_history_connection
        ON query_history(connection_id, executed_at DESC);

        CREATE TABLE IF NOT EXISTS encrypted_passwords (
            connection_id TEXT PRIMARY KEY,
            ciphertext TEXT NOT NULL,
            nonce TEXT NOT NULL
        );",
    )
}
