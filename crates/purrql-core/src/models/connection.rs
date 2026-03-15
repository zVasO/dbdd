use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub id: Uuid,
    pub name: String,
    pub db_type: DatabaseType,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: Option<String>,
    pub ssl_mode: SslMode,
    pub ssh_tunnel: Option<SshTunnelConfig>,
    pub color: Option<String>,
    pub pool_size: Option<u32>,
    pub query_timeout_ms: Option<u64>,
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4(),
            name: String::new(),
            db_type: DatabaseType::Mysql,
            host: "localhost".to_string(),
            port: 3306,
            username: String::new(),
            database: None,
            ssl_mode: SslMode::default(),
            ssh_tunnel: None,
            color: None,
            pool_size: None,
            query_timeout_ms: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseType {
    Mysql,
    Sqlite,
    Postgres,
    Mongodb,
}

impl DatabaseType {
    pub fn default_port(&self) -> u16 {
        match self {
            Self::Mysql => 3306,
            Self::Sqlite => 0,
            Self::Postgres => 5432,
            Self::Mongodb => 27017,
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Mysql => "MySQL",
            Self::Sqlite => "SQLite",
            Self::Postgres => "PostgreSQL",
            Self::Mongodb => "MongoDB",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SslMode {
    #[default]
    Disable,
    Prefer,
    Require,
    VerifyCa,
    VerifyFull,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshTunnelConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshAuthMethod,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum SshAuthMethod {
    Password,
    PrivateKey { key_path: String },
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    pub config: ConnectionConfig,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_used_at: Option<chrono::DateTime<chrono::Utc>>,
    pub sort_order: i32,
}
