use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::types::DataType;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub query_id: Uuid,
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<Row>,
    pub total_rows: Option<u64>,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
    pub warnings: Vec<String>,
    pub result_type: ResultType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ResultType {
    Select,
    Insert,
    Update,
    Delete,
    DDL,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnMeta {
    pub name: String,
    pub data_type: DataType,
    pub native_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub max_length: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    pub cells: Vec<CellValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "value")]
pub enum CellValue {
    Null,
    Integer(i64),
    Float(f64),
    Boolean(bool),
    Text(String),
    Json(serde_json::Value),
    DateTime(String),
    Date(String),
    Time(String),
    Uuid(String),
    Bytes { size: u64, preview: String },
    Array(Vec<CellValue>),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryHistoryEntry {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub sql: String,
    pub executed_at: chrono::DateTime<chrono::Utc>,
    pub duration_ms: u64,
    pub row_count: Option<u64>,
    pub status: QueryStatus,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum QueryStatus {
    Success,
    Error,
    Cancelled,
}
