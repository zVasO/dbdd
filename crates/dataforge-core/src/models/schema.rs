use serde::{Deserialize, Serialize};

use super::types::DataType;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct TableRef {
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseInfo {
    pub name: String,
    pub size_bytes: Option<u64>,
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaInfo {
    pub name: String,
    pub owner: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub table_type: TableType,
    pub row_count_estimate: Option<u64>,
    pub size_bytes: Option<u64>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TableType {
    Table,
    View,
    MaterializedView,
    ForeignTable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub table_ref: TableRef,
    pub columns: Vec<ColumnInfo>,
    pub primary_key: Option<PrimaryKeyInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub constraints: Vec<ConstraintInfo>,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub mapped_type: DataType,
    pub nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub ordinal_position: i32,
    pub comment: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimaryKeyInfo {
    pub name: Option<String>,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: TableRef,
    pub referenced_columns: Vec<String>,
    pub on_update: FkAction,
    pub on_delete: FkAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FkAction {
    NoAction,
    Restrict,
    Cascade,
    SetNull,
    SetDefault,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: ConstraintType,
    pub columns: Vec<String>,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ConstraintType {
    PrimaryKey,
    Unique,
    Check,
    Exclusion,
    ForeignKey,
}
