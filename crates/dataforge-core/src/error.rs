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

/// Structured error returned to the frontend via Tauri IPC.
/// The frontend can match on `code` for programmatic error handling.
#[derive(Debug, Clone, serde::Serialize)]
pub struct IpcError {
    pub code: String,
    pub message: String,
}

impl From<DataForgeError> for IpcError {
    fn from(e: DataForgeError) -> Self {
        let code = match &e {
            DataForgeError::Connection(_) => "CONNECTION_FAILED",
            DataForgeError::Authentication(_) => "AUTHENTICATION_FAILED",
            DataForgeError::QueryExecution(_) => "QUERY_EXECUTION_FAILED",
            DataForgeError::QueryCancelled => "QUERY_CANCELLED",
            DataForgeError::QueryTimeout(_) => "QUERY_TIMEOUT",
            DataForgeError::SchemaInspection(_) => "SCHEMA_INSPECTION_FAILED",
            DataForgeError::SshTunnel(_) => "SSH_TUNNEL_ERROR",
            DataForgeError::Config(_) => "CONFIG_ERROR",
            DataForgeError::Serialization(_) => "SERIALIZATION_ERROR",
            DataForgeError::DriverNotFound(_) => "DRIVER_NOT_FOUND",
            DataForgeError::NotSupported(_) => "NOT_SUPPORTED",
            DataForgeError::Internal(_) => "INTERNAL_ERROR",
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
