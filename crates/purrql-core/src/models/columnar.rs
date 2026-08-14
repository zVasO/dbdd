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

impl ColumnKind {
    /// Wire tag matching `ColumnData`'s `kind` field (`Integers`/`Floats`/
    /// `Booleans`/`Strings`/`Json`), so the kind sent once in stream metadata
    /// and the `kind` tag on every chunk's `ColumnData` share one vocabulary.
    pub fn as_column_data_tag(&self) -> &'static str {
        match self {
            ColumnKind::Integer => "Integers",
            ColumnKind::Float => "Floats",
            ColumnKind::Boolean => "Booleans",
            ColumnKind::String => "Strings",
            ColumnKind::Json => "Json",
        }
    }
}

/// Maps a column's declared `DataType` to the `ColumnKind` used to lay out
/// its values. This is the single source of truth for streaming: it is
/// computed once from the same column metadata sent to the frontend as
/// `meta.columns`, then reused for every chunk so no chunk can re-infer a
/// different kind from its own (possibly all-NULL) cells.
///
/// `Decimal` stays `String`, not `Float`: every driver (Postgres NUMERIC via
/// `BigDecimal::to_string`, MySQL DECIMAL/NEWDECIMAL) decodes decimals to
/// `CellValue::Text` on purpose, to avoid the precision loss `f64` would
/// introduce. Bucketing it as `Float` would make `extract_float` return
/// `None` for every row (a `Text` cell isn't `Integer`/`Float`), silently
/// nulling every decimal value.
pub fn column_kind_for_data_type(data_type: &DataType) -> ColumnKind {
    match data_type {
        DataType::SmallInt | DataType::Integer | DataType::BigInt | DataType::Serial | DataType::BigSerial => {
            ColumnKind::Integer
        }
        DataType::Float | DataType::Double => ColumnKind::Float,
        DataType::Boolean => ColumnKind::Boolean,
        DataType::Json | DataType::Jsonb => ColumnKind::Json,
        _ => ColumnKind::String,
    }
}

fn integer_from_cell(cell: &CellValue) -> Option<i64> {
    match cell {
        CellValue::Integer(v) => Some(*v),
        _ => None,
    }
}

fn float_from_cell(cell: &CellValue) -> Option<f64> {
    match cell {
        CellValue::Float(v) => Some(*v),
        CellValue::Integer(v) => Some(*v as f64),
        _ => None,
    }
}

fn boolean_from_cell(cell: &CellValue) -> Option<bool> {
    match cell {
        CellValue::Boolean(v) => Some(*v),
        _ => None,
    }
}

fn json_from_cell(cell: CellValue) -> Option<serde_json::Value> {
    match cell {
        CellValue::Json(v) => Some(v),
        _ => None,
    }
}

fn string_from_cell(cell: CellValue) -> Option<String> {
    match cell {
        CellValue::Text(v) => Some(v),
        CellValue::DateTime(v) => Some(v),
        CellValue::Date(v) => Some(v),
        CellValue::Time(v) => Some(v),
        CellValue::Uuid(v) => Some(v),
        CellValue::Bytes { preview, .. } => Some(preview),
        CellValue::Array(items) => Some(serde_json::to_string(&items).unwrap_or_default()),
        CellValue::Integer(v) => Some(v.to_string()),
        CellValue::Float(v) => Some(v.to_string()),
        CellValue::Boolean(v) => Some(v.to_string()),
        CellValue::Json(v) => Some(v.to_string()),
        CellValue::Null => None,
    }
}

fn extract_integer(cells: &[CellValue], col_idx: usize) -> Option<i64> {
    cells.get(col_idx).and_then(integer_from_cell)
}

fn extract_float(cells: &[CellValue], col_idx: usize) -> Option<f64> {
    cells.get(col_idx).and_then(float_from_cell)
}

fn extract_boolean(cells: &[CellValue], col_idx: usize) -> Option<bool> {
    cells.get(col_idx).and_then(boolean_from_cell)
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
        Some(cell) => string_from_cell(std::mem::replace(cell, CellValue::Null)),
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

/// Accumulates cells straight into the per-column arrays that go on the wire,
/// so a driver that can decode a cell at a time never builds the intermediate
/// `Vec<Row>` (nor its ~40-byte `CellValue` per cell) at all.
///
/// The kinds are fixed at construction from the column metadata — the same
/// `column_kind_for_data_type` the stream path uses — so a cell that
/// disagrees with its column's kind is coerced rather than allowed to change
/// the layout mid-result. Coercion goes through the same helpers
/// `rows_to_columnar_chunk` uses, so a driver-built result and a streamed one
/// are identical on the wire.
pub struct ColumnarBuilder {
    columns: Vec<ColumnData>,
}

impl ColumnarBuilder {
    pub fn new(kinds: &[ColumnKind], row_capacity: usize) -> Self {
        let columns = kinds
            .iter()
            .map(|kind| match kind {
                ColumnKind::Integer => ColumnData::Integers {
                    values: Vec::with_capacity(row_capacity),
                },
                ColumnKind::Float => ColumnData::Floats {
                    values: Vec::with_capacity(row_capacity),
                },
                ColumnKind::Boolean => ColumnData::Booleans {
                    values: Vec::with_capacity(row_capacity),
                },
                ColumnKind::String => ColumnData::Strings {
                    values: Vec::with_capacity(row_capacity),
                },
                ColumnKind::Json => ColumnData::Json {
                    values: Vec::with_capacity(row_capacity),
                },
            })
            .collect();

        Self { columns }
    }

    /// Append `cell` to column `col_idx`. An index past the declared columns
    /// is dropped, mirroring how the row path reads a missing cell as null.
    pub fn push_cell(&mut self, col_idx: usize, cell: CellValue) {
        let Some(column) = self.columns.get_mut(col_idx) else {
            return;
        };
        match column {
            ColumnData::Integers { values } => values.push(integer_from_cell(&cell)),
            ColumnData::Floats { values } => values.push(float_from_cell(&cell)),
            ColumnData::Booleans { values } => values.push(boolean_from_cell(&cell)),
            ColumnData::Json { values } => values.push(json_from_cell(cell)),
            ColumnData::Strings { values } => values.push(string_from_cell(cell)),
        }
    }

    pub fn finish(self) -> Vec<ColumnData> {
        self.columns
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
            ColumnKind::String
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

    #[test]
    fn decimal_chunk_preserves_text_encoded_values_instead_of_nulling_them() {
        // Postgres NUMERIC and MySQL DECIMAL/NEWDECIMAL both decode to
        // CellValue::Text to keep exact precision — the kind used to lay out
        // a Decimal column must accept that, not silently null every value.
        let kinds = vec![column_kind_for_data_type(&DataType::Decimal {
            precision: Some(10),
            scale: Some(2),
        })];

        let chunk = vec![
            row(vec![CellValue::Text("123.45".to_string())]),
            row(vec![CellValue::Null]),
            row(vec![CellValue::Text("-0.10".to_string())]),
        ];
        let result = rows_to_columnar_chunk(&chunk, 1, &kinds);
        assert_eq!(result.len(), 1);
        assert!(matches!(
            &result[0],
            ColumnData::Strings { values } if values == &vec![
                Some("123.45".to_string()),
                None,
                Some("-0.10".to_string()),
            ]
        ));
    }

    fn all_kinds() -> Vec<ColumnKind> {
        vec![
            ColumnKind::Integer,
            ColumnKind::Float,
            ColumnKind::Boolean,
            ColumnKind::String,
            ColumnKind::Json,
        ]
    }

    fn build_from_rows(kinds: &[ColumnKind], rows: &[Row]) -> Vec<ColumnData> {
        let mut builder = ColumnarBuilder::new(kinds, rows.len());
        for row in rows {
            for (col_idx, cell) in row.cells.iter().enumerate() {
                builder.push_cell(col_idx, cell.clone());
            }
        }
        builder.finish()
    }

    #[test]
    fn builder_lays_out_one_tagged_array_per_kind_and_keeps_nulls() {
        let kinds = all_kinds();
        let rows = vec![
            row(vec![
                CellValue::Integer(5),
                CellValue::Float(1.5),
                CellValue::Boolean(true),
                CellValue::Text("a".to_string()),
                CellValue::Json(serde_json::json!({"k": 1})),
            ]),
            row(vec![
                CellValue::Null,
                CellValue::Null,
                CellValue::Null,
                CellValue::Null,
                CellValue::Null,
            ]),
        ];

        let data = build_from_rows(&kinds, &rows);

        assert_eq!(data.len(), 5);
        assert!(matches!(
            &data[0],
            ColumnData::Integers { values } if values == &vec![Some(5), None]
        ));
        assert!(matches!(
            &data[1],
            ColumnData::Floats { values } if values == &vec![Some(1.5), None]
        ));
        assert!(matches!(
            &data[2],
            ColumnData::Booleans { values } if values == &vec![Some(true), None]
        ));
        assert!(matches!(
            &data[3],
            ColumnData::Strings { values } if values == &vec![Some("a".to_string()), None]
        ));
        assert!(matches!(
            &data[4],
            ColumnData::Json { values } if values == &vec![Some(serde_json::json!({"k": 1})), None]
        ));
    }

    #[test]
    fn builder_with_no_rows_still_emits_one_empty_array_per_column() {
        let data = build_from_rows(&all_kinds(), &[]);

        assert_eq!(data.len(), 5);
        assert!(matches!(&data[0], ColumnData::Integers { values } if values.is_empty()));
        assert!(matches!(&data[4], ColumnData::Json { values } if values.is_empty()));
    }

    #[test]
    fn builder_coerces_mismatched_cells_exactly_like_a_streamed_chunk() {
        // A driver-built column and a streamed chunk of the same rows must be
        // byte-identical on the wire, including where a cell disagrees with
        // its column's declared kind.
        let kinds = all_kinds();
        let rows = vec![
            row(vec![
                CellValue::Text("not an int".to_string()),
                CellValue::Integer(3),
                CellValue::Text("true".to_string()),
                CellValue::Integer(7),
                CellValue::Text("not json".to_string()),
            ]),
            row(vec![
                CellValue::Boolean(false),
                CellValue::Text("1.25".to_string()),
                CellValue::Integer(1),
                CellValue::Bytes {
                    size: 2,
                    preview: "\\x0102".to_string(),
                },
                CellValue::Json(serde_json::json!([1, 2])),
            ]),
            row(vec![
                CellValue::Integer(9),
                CellValue::Float(2.5),
                CellValue::Boolean(true),
                CellValue::Array(vec![CellValue::Integer(1), CellValue::Null]),
                CellValue::Null,
            ]),
        ];

        let streamed = rows_to_columnar_chunk(&rows, kinds.len(), &kinds);
        let built = build_from_rows(&kinds, &rows);

        assert_eq!(
            serde_json::to_value(&built).unwrap(),
            serde_json::to_value(&streamed).unwrap()
        );
    }

    #[test]
    fn column_kind_wire_tag_matches_column_data_kind_vocabulary() {
        assert_eq!(ColumnKind::Integer.as_column_data_tag(), "Integers");
        assert_eq!(ColumnKind::Float.as_column_data_tag(), "Floats");
        assert_eq!(ColumnKind::Boolean.as_column_data_tag(), "Booleans");
        assert_eq!(ColumnKind::String.as_column_data_tag(), "Strings");
        assert_eq!(ColumnKind::Json.as_column_data_tag(), "Json");
    }
}
