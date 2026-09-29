use thiserror::Error;

#[derive(Error, Debug)]
pub enum SpoolError {
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

pub type Result<T> = std::result::Result<T, SpoolError>;

impl serde::Serialize for SpoolError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Structured error returned to the frontend via Tauri IPC.
/// The frontend can match on `code` for programmatic error handling.
#[derive(Debug, Clone, serde::Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl From<SpoolError> for IpcError {
    fn from(e: SpoolError) -> Self {
        let code = match &e {
            SpoolError::Connection(_) => "CONNECTION_FAILED",
            SpoolError::Authentication(_) => "AUTHENTICATION_FAILED",
            SpoolError::QueryExecution(_) => "QUERY_EXECUTION_FAILED",
            SpoolError::QueryCancelled => "QUERY_CANCELLED",
            SpoolError::QueryTimeout(_) => "QUERY_TIMEOUT",
            SpoolError::SchemaInspection(_) => "SCHEMA_INSPECTION_FAILED",
            SpoolError::SshTunnel(_) => "SSH_TUNNEL_ERROR",
            SpoolError::Config(_) => "CONFIG_ERROR",
            SpoolError::Serialization(_) => "SERIALIZATION_ERROR",
            SpoolError::DriverNotFound(_) => "DRIVER_NOT_FOUND",
            SpoolError::NotSupported(_) => "NOT_SUPPORTED",
            SpoolError::Internal(_) => "INTERNAL_ERROR",
        };
        IpcError {
            code: code.to_string(),
            message: e.to_string(),
        }
    }
}

impl From<String> for IpcError {
    fn from(s: String) -> Self {
        IpcError {
            code: "INTERNAL_ERROR".to_string(),
            message: s,
        }
    }
}

impl From<&str> for IpcError {
    fn from(s: &str) -> Self {
        IpcError {
            code: "INTERNAL_ERROR".to_string(),
            message: s.to_string(),
        }
    }
}
