use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::query::{CellValue, ColumnMeta, QueryResult, ResultType};
use super::types::DataType;

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
pub enum ColumnKind {
    Integer,
    Float,
    Boolean,
    String,
    Json,
}

/// Maps a column's declared `DataType` to the `ColumnKind` used to lay out
/// its values. This is the single source of truth for streaming: it is
/// computed once from the same column metadata sent to the frontend as
/// `meta.columns`, then reused for every chunk so no chunk can re-infer a
/// different kind from its own (possibly all-NULL) cells.
pub fn column_kind_for_data_type(data_type: &DataType) -> ColumnKind {
    match data_type {
        DataType::SmallInt | DataType::Integer | DataType::BigInt | DataType::Serial | DataType::BigSerial => {
            ColumnKind::Integer
        }
        DataType::Float | DataType::Double | DataType::Decimal { .. } => ColumnKind::Float,
        DataType::Boolean => ColumnKind::Boolean,
        DataType::Json | DataType::Jsonb => ColumnKind::Json,
        _ => ColumnKind::String,
    }
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
/// `kinds` must have one entry per column, determined once at stream start
/// (see `column_kind_for_data_type`) — chunks never re-infer their own kind,
/// so an all-NULL chunk cannot silently disagree with a later chunk.
pub fn rows_to_columnar_chunk(
    rows: &[super::query::Row],
    col_count: usize,
    kinds: &[ColumnKind],
) -> Vec<ColumnData> {
    if rows.is_empty() || col_count == 0 {
        return vec![];
    }

    (0..col_count)
        .map(|col_idx| build_chunk_column(rows, col_idx, &kinds[col_idx]))
        .collect()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::query::Row;

    fn row(cells: Vec<CellValue>) -> Row {
        Row { cells }
    }

    #[test]
    fn chunk_kind_stays_stable_across_all_null_then_populated_chunks() {
        let kinds = vec![column_kind_for_data_type(&DataType::Text)];

        let all_null_chunk = vec![row(vec![CellValue::Null]), row(vec![CellValue::Null])];
        let first = rows_to_columnar_chunk(&all_null_chunk, 1, &kinds);
        assert_eq!(first.len(), 1);
        assert!(matches!(
            &first[0],
            ColumnData::Strings { values } if values == &vec![None, None]
        ));

        let populated_chunk = vec![
            row(vec![CellValue::Text("a".to_string())]),
            row(vec![CellValue::Text("b".to_string())]),
        ];
        let second = rows_to_columnar_chunk(&populated_chunk, 1, &kinds);
        assert_eq!(second.len(), 1);
        assert!(matches!(
            &second[0],
            ColumnData::Strings { values } if values == &vec![Some("a".to_string()), Some("b".to_string())]
        ));
    }

    #[test]
    fn numeric_chunk_preserves_numeric_values() {
        let kinds = vec![column_kind_for_data_type(&DataType::Integer)];

        let chunk = vec![
            row(vec![CellValue::Integer(5)]),
            row(vec![CellValue::Null]),
            row(vec![CellValue::Integer(7)]),
        ];
        let result = rows_to_columnar_chunk(&chunk, 1, &kinds);
        assert_eq!(result.len(), 1);
        assert!(matches!(
            &result[0],
            ColumnData::Integers { values } if values == &vec![Some(5), None, Some(7)]
        ));
    }

    #[test]
    fn column_kind_mapping_covers_numeric_boolean_json_and_default_string() {
        assert!(matches!(
            column_kind_for_data_type(&DataType::SmallInt),
            ColumnKind::Integer
        ));
        assert!(matches!(
            column_kind_for_data_type(&DataType::BigInt),
            ColumnKind::Integer
        ));
        assert!(matches!(
            column_kind_for_data_type(&DataType::Decimal { precision: None, scale: None }),
            ColumnKind::Float
        ));
        assert!(matches!(
            column_kind_for_data_type(&DataType::Boolean),
            ColumnKind::Boolean
        ));
        assert!(matches!(
            column_kind_for_data_type(&DataType::Jsonb),
            ColumnKind::Json
        ));
        assert!(matches!(
            column_kind_for_data_type(&DataType::Uuid),
            ColumnKind::String
        ));
    }
}
