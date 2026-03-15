use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::query::{CellValue, ColumnMeta, QueryResult, ResultType};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum ColumnData {
    Integers { values: Vec<Option<i64>> },
    Floats { values: Vec<Option<f64>> },
    Booleans { values: Vec<Option<bool>> },
    Strings { values: Vec<Option<String>> },
    Json { values: Vec<Option<serde_json::Value>> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnarResult {
    pub query_id: Uuid,
    pub columns: Vec<ColumnMeta>,
    pub data: Vec<ColumnData>,
    pub row_count: usize,
    pub affected_rows: Option<u64>,
    pub execution_time_ms: u64,
    pub warnings: Vec<String>,
    pub result_type: ResultType,
}

impl From<QueryResult> for ColumnarResult {
    fn from(result: QueryResult) -> Self {
        let row_count = result.rows.len();
        let col_count = result.columns.len();

        let data = (0..col_count)
            .map(|col_idx| {
                let kind = determine_column_kind(&result, col_idx);
                build_column(&result, col_idx, row_count, &kind)
            })
            .collect();

        ColumnarResult {
            query_id: result.query_id,
            columns: result.columns,
            data,
            row_count,
            affected_rows: result.affected_rows,
            execution_time_ms: result.execution_time_ms,
            warnings: result.warnings,
            result_type: result.result_type,
        }
    }
}

/// Determines the column kind by inspecting the first non-null cell.
fn determine_column_kind(result: &QueryResult, col_idx: usize) -> ColumnKind {
    for row in &result.rows {
        if let Some(cell) = row.cells.get(col_idx) {
            match cell {
                CellValue::Null => continue,
                CellValue::Integer(_) => return ColumnKind::Integer,
                CellValue::Float(_) => return ColumnKind::Float,
                CellValue::Boolean(_) => return ColumnKind::Boolean,
                CellValue::Json(_) => return ColumnKind::Json,
                CellValue::Text(_)
                | CellValue::DateTime(_)
                | CellValue::Date(_)
                | CellValue::Time(_)
                | CellValue::Uuid(_)
                | CellValue::Bytes { .. }
                | CellValue::Array(_) => return ColumnKind::String,
            }
        }
    }

    // All cells are null — default to integers
    ColumnKind::Integer
}

/// Builds a `ColumnData` vector from the rows for a given column index.
fn build_column(
    result: &QueryResult,
    col_idx: usize,
    row_count: usize,
    kind: &ColumnKind,
) -> ColumnData {
    match kind {
        ColumnKind::Integer => {
            let mut values = Vec::with_capacity(row_count);
            for row_idx in 0..row_count {
                values.push(extract_integer(&result.rows[row_idx].cells, col_idx));
            }
            ColumnData::Integers { values }
        }
        ColumnKind::Float => {
            let mut values = Vec::with_capacity(row_count);
            for row_idx in 0..row_count {
                values.push(extract_float(&result.rows[row_idx].cells, col_idx));
            }
            ColumnData::Floats { values }
        }
        ColumnKind::Boolean => {
            let mut values = Vec::with_capacity(row_count);
            for row_idx in 0..row_count {
                values.push(extract_boolean(&result.rows[row_idx].cells, col_idx));
            }
            ColumnData::Booleans { values }
        }
        ColumnKind::Json => {
            let mut values = Vec::with_capacity(row_count);
            for row_idx in 0..row_count {
                values.push(extract_json(&result.rows[row_idx].cells, col_idx));
            }
            ColumnData::Json { values }
        }
        ColumnKind::String => {
            let mut values = Vec::with_capacity(row_count);
            for row_idx in 0..row_count {
                values.push(extract_string(&result.rows[row_idx].cells, col_idx));
            }
            ColumnData::Strings { values }
        }
    }
}

#[derive(Debug)]
enum ColumnKind {
    Integer,
    Float,
    Boolean,
    String,
    Json,
}

fn extract_integer(cells: &[CellValue], col_idx: usize) -> Option<i64> {
    match cells.get(col_idx) {
        Some(CellValue::Integer(v)) => Some(*v),
        Some(CellValue::Null) | None => None,
        _ => None,
    }
}

fn extract_float(cells: &[CellValue], col_idx: usize) -> Option<f64> {
    match cells.get(col_idx) {
        Some(CellValue::Float(v)) => Some(*v),
        Some(CellValue::Integer(v)) => Some(*v as f64),
        Some(CellValue::Null) | None => None,
        _ => None,
    }
}

fn extract_boolean(cells: &[CellValue], col_idx: usize) -> Option<bool> {
    match cells.get(col_idx) {
        Some(CellValue::Boolean(v)) => Some(*v),
        Some(CellValue::Null) | None => None,
        _ => None,
    }
}

fn extract_json(cells: &[CellValue], col_idx: usize) -> Option<serde_json::Value> {
    match cells.get(col_idx) {
        Some(CellValue::Json(v)) => Some(v.clone()),
        Some(CellValue::Null) | None => None,
        _ => None,
    }
}

fn extract_string(cells: &[CellValue], col_idx: usize) -> Option<String> {
    match cells.get(col_idx) {
        Some(CellValue::Text(v)) => Some(v.clone()),
        Some(CellValue::DateTime(v)) => Some(v.clone()),
        Some(CellValue::Date(v)) => Some(v.clone()),
        Some(CellValue::Time(v)) => Some(v.clone()),
        Some(CellValue::Uuid(v)) => Some(v.clone()),
        Some(CellValue::Bytes { preview, .. }) => Some(preview.clone()),
        Some(CellValue::Array(items)) => {
            Some(serde_json::to_string(items).unwrap_or_default())
        }
        Some(CellValue::Integer(v)) => Some(v.to_string()),
        Some(CellValue::Float(v)) => Some(v.to_string()),
        Some(CellValue::Boolean(v)) => Some(v.to_string()),
        Some(CellValue::Json(v)) => Some(v.to_string()),
        Some(CellValue::Null) | None => None,
    }
}

/// Consuming conversion from `QueryResult` into `ColumnarResult`.
///
/// Unlike the `From<QueryResult>` impl (which borrows cells via shared references
/// and clones heap-allocated values like String and serde_json::Value),
/// this method moves data out of each cell using `std::mem::take`, avoiding
/// per-cell heap allocations for strings, JSON, byte previews, and arrays.
///
/// Use this when the `QueryResult` is no longer needed after conversion
/// (e.g., the `execute_query_columnar` Tauri command).
impl ColumnarResult {
    pub fn from_query_result_consuming(mut result: QueryResult) -> Self {
        let row_count = result.rows.len();
        let col_count = result.columns.len();

        // Determine column kinds by inspecting first non-null cell (read-only pass)
        let kinds: Vec<ColumnKind> = (0..col_count)
            .map(|col_idx| determine_column_kind(&result, col_idx))
            .collect();

        // Build columns by moving values out of cells (consuming pass)
        let data = (0..col_count)
            .map(|col_idx| {
                build_column_consuming(&mut result.rows, col_idx, row_count, &kinds[col_idx])
            })
            .collect();

        ColumnarResult {
            query_id: result.query_id,
            columns: result.columns,
            data,
            row_count,
            affected_rows: result.affected_rows,
            execution_time_ms: result.execution_time_ms,
            warnings: result.warnings,
            result_type: result.result_type,
        }
    }
}

fn build_column_consuming(
    rows: &mut [super::query::Row],
    col_idx: usize,
    row_count: usize,
    kind: &ColumnKind,
) -> ColumnData {
    match kind {
        ColumnKind::Integer => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows.iter() {
                values.push(extract_integer(&row.cells, col_idx));
            }
            ColumnData::Integers { values }
        }
        ColumnKind::Float => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows.iter() {
                values.push(extract_float(&row.cells, col_idx));
            }
            ColumnData::Floats { values }
        }
        ColumnKind::Boolean => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows.iter() {
                values.push(extract_boolean(&row.cells, col_idx));
            }
            ColumnData::Booleans { values }
        }
        ColumnKind::Json => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows.iter_mut() {
                values.push(take_json(&mut row.cells, col_idx));
            }
            ColumnData::Json { values }
        }
        ColumnKind::String => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows.iter_mut() {
                values.push(take_string(&mut row.cells, col_idx));
            }
            ColumnData::Strings { values }
        }
    }
}

/// Move a string value out of the cell, replacing it with `CellValue::Null`.
/// Avoids cloning heap-allocated strings.
fn take_string(cells: &mut [CellValue], col_idx: usize) -> Option<String> {
    match cells.get_mut(col_idx) {
        Some(cell) => match std::mem::replace(cell, CellValue::Null) {
            CellValue::Text(v) => Some(v),
            CellValue::DateTime(v) => Some(v),
            CellValue::Date(v) => Some(v),
            CellValue::Time(v) => Some(v),
            CellValue::Uuid(v) => Some(v),
            CellValue::Bytes { preview, .. } => Some(preview),
            CellValue::Array(items) => {
                Some(serde_json::to_string(&items).unwrap_or_default())
            }
            CellValue::Integer(v) => Some(v.to_string()),
            CellValue::Float(v) => Some(v.to_string()),
            CellValue::Boolean(v) => Some(v.to_string()),
            CellValue::Json(v) => Some(v.to_string()),
            CellValue::Null => None,
        },
        None => None,
    }
}

/// Move a JSON value out of the cell, replacing it with `CellValue::Null`.
fn take_json(cells: &mut [CellValue], col_idx: usize) -> Option<serde_json::Value> {
    match cells.get_mut(col_idx) {
        Some(cell) => match std::mem::replace(cell, CellValue::Null) {
            CellValue::Json(v) => Some(v),
            CellValue::Null => None,
            other => {
                // Put back non-JSON values; this path should not occur in practice
                *cell = other;
                None
            }
        },
        None => None,
    }
}

/// Convert a chunk of rows into columnar ColumnData vectors.
/// Used by streaming query execution to convert row chunks on-the-fly.
pub fn rows_to_columnar_chunk(
    rows: &[super::query::Row],
    col_count: usize,
) -> Vec<ColumnData> {
    if rows.is_empty() || col_count == 0 {
        return vec![];
    }

    (0..col_count)
        .map(|col_idx| {
            let kind = determine_chunk_column_kind(rows, col_idx);
            build_chunk_column(rows, col_idx, &kind)
        })
        .collect()
}

fn determine_chunk_column_kind(rows: &[super::query::Row], col_idx: usize) -> ColumnKind {
    for row in rows {
        if let Some(cell) = row.cells.get(col_idx) {
            match cell {
                CellValue::Null => continue,
                CellValue::Integer(_) => return ColumnKind::Integer,
                CellValue::Float(_) => return ColumnKind::Float,
                CellValue::Boolean(_) => return ColumnKind::Boolean,
                CellValue::Json(_) => return ColumnKind::Json,
                _ => return ColumnKind::String,
            }
        }
    }
    ColumnKind::Integer
}

fn build_chunk_column(
    rows: &[super::query::Row],
    col_idx: usize,
    kind: &ColumnKind,
) -> ColumnData {
    let row_count = rows.len();
    match kind {
        ColumnKind::Integer => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows {
                values.push(extract_integer(&row.cells, col_idx));
            }
            ColumnData::Integers { values }
        }
        ColumnKind::Float => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows {
                values.push(extract_float(&row.cells, col_idx));
            }
            ColumnData::Floats { values }
        }
        ColumnKind::Boolean => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows {
                values.push(extract_boolean(&row.cells, col_idx));
            }
            ColumnData::Booleans { values }
        }
        ColumnKind::Json => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows {
                values.push(extract_json(&row.cells, col_idx));
            }
            ColumnData::Json { values }
        }
        ColumnKind::String => {
            let mut values = Vec::with_capacity(row_count);
            for row in rows {
                values.push(extract_string(&row.cells, col_idx));
            }
            ColumnData::Strings { values }
        }
    }
}
