use std::collections::HashMap;
use std::sync::LazyLock;

use mysql_async::consts::ColumnType;

use purrql_core::models::query::CellValue;
use purrql_core::models::types::DataType;

static MYSQL_TYPE_MAP: LazyLock<HashMap<&'static str, DataType>> = LazyLock::new(|| {
    HashMap::from([
        ("tinyint", DataType::SmallInt),
        ("smallint", DataType::SmallInt),
        ("mediumint", DataType::Integer),
        ("int", DataType::Integer),
        ("integer", DataType::Integer),
        ("bigint", DataType::BigInt),
        ("float", DataType::Float),
        ("double", DataType::Double),
        ("real", DataType::Double),
        ("decimal", DataType::Decimal { precision: None, scale: None }),
        ("numeric", DataType::Decimal { precision: None, scale: None }),
        ("dec", DataType::Decimal { precision: None, scale: None }),
        ("bit", DataType::Boolean),
        ("bool", DataType::Boolean),
        ("boolean", DataType::Boolean),
        ("char", DataType::Char(None)),
        ("varchar", DataType::Varchar(None)),
        ("tinytext", DataType::Text),
        ("text", DataType::Text),
        ("mediumtext", DataType::Text),
        ("longtext", DataType::Text),
        ("tinyblob", DataType::Blob),
        ("blob", DataType::Blob),
        ("mediumblob", DataType::Blob),
        ("longblob", DataType::Blob),
        ("binary", DataType::Blob),
        ("varbinary", DataType::Blob),
        ("date", DataType::Date),
        ("time", DataType::Time),
        ("datetime", DataType::Timestamp),
        ("timestamp", DataType::Timestamp),
        ("year", DataType::Integer),
        ("json", DataType::Json),
        ("set", DataType::Text),
    ])
});

/// Map a mysql_async Column to our DataType + native type string (with size info).
pub fn map_column_meta(col: &mysql_async::Column) -> (DataType, String) {
    let ct = col.column_type();
    let len = col.column_length() as u32;
    let decimals = col.decimals() as u32;
    let charset = col.character_set();

    // Bytes-per-char for the charset (used to convert byte length → char length)
    let bpc = match charset {
        45 | 46 | 224..=247 => 4, // utf8mb4
        33 | 83 | 192..=215 => 3, // utf8mb3 / utf8
        63 => 1,                   // binary
        _ => 1,                    // latin1 and most single-byte charsets
    };

    let char_len = if bpc > 0 { len / bpc } else { len };

    match ct {
        ColumnType::MYSQL_TYPE_TINY => (DataType::SmallInt, "tinyint".into()),
        ColumnType::MYSQL_TYPE_SHORT => (DataType::SmallInt, "smallint".into()),
        ColumnType::MYSQL_TYPE_INT24 => (DataType::Integer, "mediumint".into()),
        ColumnType::MYSQL_TYPE_LONG => (DataType::Integer, "int".into()),
        ColumnType::MYSQL_TYPE_LONGLONG => (DataType::BigInt, "bigint".into()),
        ColumnType::MYSQL_TYPE_FLOAT => (DataType::Float, "float".into()),
        ColumnType::MYSQL_TYPE_DOUBLE => (DataType::Double, "double".into()),
        ColumnType::MYSQL_TYPE_DECIMAL | ColumnType::MYSQL_TYPE_NEWDECIMAL => {
            let p = if len > 0 { Some(len) } else { None };
            let s = if decimals > 0 { Some(decimals) } else { None };
            let native = match (p, s) {
                (Some(p), Some(s)) => format!("decimal({},{})", p, s),
                (Some(p), None) => format!("decimal({})", p),
                _ => "decimal".into(),
            };
            (DataType::Decimal { precision: p, scale: s }, native)
        }
        ColumnType::MYSQL_TYPE_BIT => (DataType::Boolean, "bit".into()),
        ColumnType::MYSQL_TYPE_STRING => {
            let n = if char_len > 0 { Some(char_len) } else { None };
            let native = match n {
                Some(n) => format!("char({})", n),
                None => "char".into(),
            };
            (DataType::Char(n), native)
        }
        ColumnType::MYSQL_TYPE_VARCHAR | ColumnType::MYSQL_TYPE_VAR_STRING => {
            let n = if char_len > 0 { Some(char_len) } else { None };
            let native = match n {
                Some(n) => format!("varchar({})", n),
                None => "varchar".into(),
            };
            (DataType::Varchar(n), native)
        }
        ColumnType::MYSQL_TYPE_TINY_BLOB => (DataType::Text, "tinytext".into()),
        ColumnType::MYSQL_TYPE_MEDIUM_BLOB => (DataType::Text, "mediumtext".into()),
        ColumnType::MYSQL_TYPE_LONG_BLOB => (DataType::Blob, "longblob".into()),
        ColumnType::MYSQL_TYPE_BLOB => (DataType::Text, "text".into()),
        ColumnType::MYSQL_TYPE_DATE | ColumnType::MYSQL_TYPE_NEWDATE => (DataType::Date, "date".into()),
        ColumnType::MYSQL_TYPE_TIME | ColumnType::MYSQL_TYPE_TIME2 => (DataType::Time, "time".into()),
        ColumnType::MYSQL_TYPE_DATETIME | ColumnType::MYSQL_TYPE_DATETIME2 => (DataType::Timestamp, "datetime".into()),
        ColumnType::MYSQL_TYPE_TIMESTAMP | ColumnType::MYSQL_TYPE_TIMESTAMP2 => (DataType::Timestamp, "timestamp".into()),
        ColumnType::MYSQL_TYPE_YEAR => (DataType::Integer, "year".into()),
        ColumnType::MYSQL_TYPE_JSON => (DataType::Json, "json".into()),
        ColumnType::MYSQL_TYPE_ENUM => (DataType::Enum { name: String::new(), values: vec![] }, "enum".into()),
        ColumnType::MYSQL_TYPE_SET => (DataType::Text, "set".into()),
        ColumnType::MYSQL_TYPE_GEOMETRY => (DataType::Unknown("geometry".into()), "geometry".into()),
        ColumnType::MYSQL_TYPE_NULL => (DataType::Unknown("null".into()), "null".into()),
        _ => (DataType::Unknown(format!("{:?}", ct)), "unknown".into()),
    }
}

pub fn map_mysql_type(native_type: &str) -> DataType {
    let lower = native_type.to_lowercase();
    let base = lower.split('(').next().unwrap_or(&lower).trim();

    // O(1) lookup via static HashMap instead of match-chain with to_lowercase per call
    if let Some(dt) = MYSQL_TYPE_MAP.get(base) {
        return dt.clone();
    }

    // Special cases that need constructed values
    if base == "enum" {
        return DataType::Enum {
            name: String::new(),
            values: vec![],
        };
    }

    DataType::Unknown(native_type.to_string())
}

fn uint_cell(n: u64) -> CellValue {
    if n <= i64::MAX as u64 {
        CellValue::Integer(n as i64)
    } else {
        CellValue::Text(n.to_string())
    }
}

fn text_or_bytes(b: &[u8]) -> CellValue {
    match std::str::from_utf8(b) {
        Ok(s) => CellValue::Text(s.to_string()),
        Err(_) => CellValue::Bytes {
            size: b.len() as u64,
            preview: format!("0x{}", hex_preview(b, 32)),
        },
    }
}

/// The MySQL text protocol delivers every value as `Bytes` (ASCII), so a raw
/// SELECT loses typing. Recover it from the column type, letting `str::parse`
/// do the conversion — decimals stay textual to preserve exact precision.
fn bytes_cell_by_type(row: &mysql_async::Row, index: usize, b: &[u8]) -> CellValue {
    use ColumnType::*;

    let Some(ct) = row.columns_ref().get(index).map(|c| c.column_type()) else {
        return text_or_bytes(b);
    };
    let Ok(s) = std::str::from_utf8(b) else {
        return text_or_bytes(b);
    };
    let trimmed = s.trim();

    match ct {
        MYSQL_TYPE_TINY | MYSQL_TYPE_SHORT | MYSQL_TYPE_INT24 | MYSQL_TYPE_LONG
        | MYSQL_TYPE_LONGLONG | MYSQL_TYPE_YEAR => trimmed
            .parse::<i64>()
            .map(CellValue::Integer)
            .or_else(|_| trimmed.parse::<u64>().map(uint_cell))
            .unwrap_or_else(|_| text_or_bytes(b)),
        MYSQL_TYPE_FLOAT | MYSQL_TYPE_DOUBLE => trimmed
            .parse::<f64>()
            .map(CellValue::Float)
            .unwrap_or_else(|_| text_or_bytes(b)),
        MYSQL_TYPE_DATE | MYSQL_TYPE_DATETIME | MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_NEWDATE => {
            CellValue::DateTime(s.to_string())
        }
        MYSQL_TYPE_TIME => CellValue::Time(s.to_string()),
        _ => text_or_bytes(b),
    }
}

pub fn mysql_value_to_cell(row: &mysql_async::Row, index: usize) -> CellValue {
    use mysql_async::Value;

    let Some(value) = row.as_ref(index) else {
        return CellValue::Null;
    };
    if let Value::Bytes(b) = value {
        return bytes_cell_by_type(row, index, b);
    }

    let col = row.columns_ref().get(index);
    value_to_cell(
        value,
        col.map(|c| c.column_type()),
        col.map(|c| c.decimals()).unwrap_or(0),
    )
}

/// Renders the `.ffffff`-style fractional-seconds suffix that MySQL's text
/// protocol emits for a DATETIME/TIMESTAMP/TIME column, truncated to the
/// column's declared `decimals` precision (0 = no fractional part).
fn fractional_suffix(micro_seconds: u32, decimals: u8) -> String {
    if decimals == 0 {
        return String::new();
    }
    let digits = (decimals as usize).min(6);
    let scaled = micro_seconds / 10u32.pow((6 - digits) as u32);
    format!(".{:0width$}", scaled, width = digits)
}

/// Value-only mapping from a binary-protocol `Value` to `CellValue`, given
/// just the column type and decimals precision needed to match the text
/// protocol's formatting exactly (no `Row`/`Column` required, so this is
/// directly unit-testable). `Value::Bytes` is handled by the caller via
/// `bytes_cell_by_type`, which needs the full row for column-typed parsing.
fn value_to_cell(value: &mysql_async::Value, ct: Option<ColumnType>, decimals: u8) -> CellValue {
    use mysql_async::Value;
    use ColumnType::*;

    match value {
        Value::NULL => CellValue::Null,
        Value::Int(n) => CellValue::Integer(*n),
        Value::UInt(n) => uint_cell(*n),
        Value::Float(n) => CellValue::Float(*n as f64),
        Value::Double(n) => CellValue::Float(*n),
        Value::Bytes(b) => text_or_bytes(b),
        Value::Date(y, m, d, h, min, s, us) => {
            if matches!(ct, Some(MYSQL_TYPE_DATE) | Some(MYSQL_TYPE_NEWDATE)) {
                // A DATE column has no time component in the text protocol.
                CellValue::DateTime(format!("{:04}-{:02}-{:02}", y, m, d))
            } else {
                CellValue::DateTime(format!(
                    "{:04}-{:02}-{:02} {:02}:{:02}:{:02}{}",
                    y,
                    m,
                    d,
                    h,
                    min,
                    s,
                    fractional_suffix(*us, decimals)
                ))
            }
        }
        Value::Time(neg, d, h, min, s, us) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = *d * 24 + (*h as u32);
            CellValue::Time(format!(
                "{}{:02}:{:02}:{:02}{}",
                sign,
                total_h,
                min,
                s,
                fractional_suffix(*us, decimals)
            ))
        }
    }
}

fn hex_preview(bytes: &[u8], max_chars: usize) -> String {
    use std::fmt::Write;
    let max_bytes = max_chars / 2;
    let take = bytes.len().min(max_bytes);
    let mut s = String::with_capacity(take * 2);
    for b in bytes.iter().take(take) {
        write!(s, "{:02x}", b).unwrap();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;
    use mysql_async::Value;

    /// Pins the text-protocol rendering these binary variants must match:
    /// dates as `YYYY-MM-DD HH:MM:SS`, plain DATE columns as `YYYY-MM-DD`,
    /// times as `HH:MM:SS`, both with a `.ffffff`-truncated fractional
    /// suffix when the column declares decimals.

    #[test]
    fn null_maps_to_null() {
        assert!(matches!(value_to_cell(&Value::NULL, None, 0), CellValue::Null));
    }

    #[test]
    fn int_maps_to_integer() {
        match value_to_cell(&Value::Int(42), None, 0) {
            CellValue::Integer(n) => assert_eq!(n, 42),
            other => panic!("expected Integer, got {other:?}"),
        }
    }

    #[test]
    fn uint_within_i64_range_maps_to_integer() {
        match value_to_cell(&Value::UInt(42), None, 0) {
            CellValue::Integer(n) => assert_eq!(n, 42),
            other => panic!("expected Integer, got {other:?}"),
        }
    }

    #[test]
    fn uint_beyond_i64_range_maps_to_text() {
        let n = u64::MAX;
        match value_to_cell(&Value::UInt(n), None, 0) {
            CellValue::Text(s) => assert_eq!(s, n.to_string()),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[test]
    fn float_widens_to_f64() {
        match value_to_cell(&Value::Float(1.5), None, 0) {
            CellValue::Float(n) => assert_eq!(n, 1.5),
            other => panic!("expected Float, got {other:?}"),
        }
    }

    #[test]
    fn double_maps_to_float() {
        match value_to_cell(&Value::Double(1.5), None, 0) {
            CellValue::Float(n) => assert_eq!(n, 1.5),
            other => panic!("expected Float, got {other:?}"),
        }
    }

    #[test]
    fn bytes_maps_to_text() {
        match value_to_cell(&Value::Bytes(b"text".to_vec()), None, 0) {
            CellValue::Text(s) => assert_eq!(s, "text"),
            other => panic!("expected Text, got {other:?}"),
        }
    }

    #[test]
    fn datetime_column_renders_date_and_time_no_fraction() {
        let v = Value::Date(2024, 1, 15, 10, 30, 0, 0);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_DATETIME), 0) {
            CellValue::DateTime(s) => assert_eq!(s, "2024-01-15 10:30:00"),
            other => panic!("expected DateTime, got {other:?}"),
        }
    }

    #[test]
    fn timestamp_column_renders_date_and_time_no_fraction() {
        let v = Value::Date(2024, 1, 15, 10, 30, 0, 0);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_TIMESTAMP), 0) {
            CellValue::DateTime(s) => assert_eq!(s, "2024-01-15 10:30:00"),
            other => panic!("expected DateTime, got {other:?}"),
        }
    }

    #[test]
    fn date_column_renders_date_only_dropping_midnight_time() {
        // A DATE column's binary value has zeroed h/min/s — the text
        // protocol never shows a time part for it, so neither should we.
        let v = Value::Date(2024, 1, 15, 0, 0, 0, 0);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_DATE), 0) {
            CellValue::DateTime(s) => assert_eq!(s, "2024-01-15"),
            other => panic!("expected DateTime, got {other:?}"),
        }
    }

    #[test]
    fn newdate_column_renders_date_only() {
        let v = Value::Date(2024, 1, 15, 0, 0, 0, 0);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_NEWDATE), 0) {
            CellValue::DateTime(s) => assert_eq!(s, "2024-01-15"),
            other => panic!("expected DateTime, got {other:?}"),
        }
    }

    #[test]
    fn datetime_with_declared_decimals_renders_truncated_fraction() {
        // 123456 microseconds through a DATETIME(6) column -> full 6 digits.
        let v = Value::Date(2024, 1, 15, 10, 30, 0, 123_456);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_DATETIME), 6) {
            CellValue::DateTime(s) => assert_eq!(s, "2024-01-15 10:30:00.123456"),
            other => panic!("expected DateTime, got {other:?}"),
        }

        // Same microseconds through a DATETIME(3) column -> 3 leading digits.
        let v = Value::Date(2024, 1, 15, 10, 30, 0, 123_456);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_DATETIME), 3) {
            CellValue::DateTime(s) => assert_eq!(s, "2024-01-15 10:30:00.123"),
            other => panic!("expected DateTime, got {other:?}"),
        }
    }

    #[test]
    fn unknown_column_context_defaults_to_full_datetime() {
        // No column info available (e.g. a synthetic row) — fall back to the
        // safe default of rendering the full date+time.
        let v = Value::Date(2024, 1, 15, 10, 30, 0, 0);
        match value_to_cell(&v, None, 0) {
            CellValue::DateTime(s) => assert_eq!(s, "2024-01-15 10:30:00"),
            other => panic!("expected DateTime, got {other:?}"),
        }
    }

    #[test]
    fn time_renders_hh_mm_ss_no_fraction() {
        let v = Value::Time(false, 0, 1, 2, 3, 0);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_TIME), 0) {
            CellValue::Time(s) => assert_eq!(s, "01:02:03"),
            other => panic!("expected Time, got {other:?}"),
        }
    }

    #[test]
    fn negative_time_keeps_sign() {
        let v = Value::Time(true, 0, 1, 2, 3, 0);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_TIME), 0) {
            CellValue::Time(s) => assert_eq!(s, "-01:02:03"),
            other => panic!("expected Time, got {other:?}"),
        }
    }

    #[test]
    fn time_with_days_folds_into_hours() {
        // MySQL TIME can exceed 24h; days*24 + hours is the total hour count.
        let v = Value::Time(false, 1, 2, 3, 4, 0);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_TIME), 0) {
            CellValue::Time(s) => assert_eq!(s, "26:03:04"),
            other => panic!("expected Time, got {other:?}"),
        }
    }

    #[test]
    fn time_with_declared_decimals_renders_truncated_fraction() {
        let v = Value::Time(false, 0, 1, 2, 3, 500_000);
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_TIME), 6) {
            CellValue::Time(s) => assert_eq!(s, "01:02:03.500000"),
            other => panic!("expected Time, got {other:?}"),
        }
        match value_to_cell(&v, Some(ColumnType::MYSQL_TYPE_TIME), 3) {
            CellValue::Time(s) => assert_eq!(s, "01:02:03.500"),
            other => panic!("expected Time, got {other:?}"),
        }
    }
}
