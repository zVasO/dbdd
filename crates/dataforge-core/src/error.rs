use thiserror::Error;

#[derive(Error, Debug)]
pub enum DataForgeError {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Authentication failed: {0}")]
    Authentication(String),

    #[error("Query execution error: {0}")]
    QueryExecution(String),

    #[error("Query cancelled by user")]
    QueryCancelled,

    #[error("Query timeout after {0}ms")]
    QueryTimeout(u64),

    #[error("Schema inspection error: {0}")]
    SchemaInspection(String),

    #[error("SSH tunnel error: {0}")]
    SshTunnel(String),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Driver not found for type: {0}")]
    DriverNotFound(String),

    #[error("Feature not supported: {0}")]
    NotSupported(String),

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, DataForgeError>;

impl serde::Serialize for DataForgeError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
