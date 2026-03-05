use mysql_async::consts::ColumnType;

use dataforge_core::models::query::CellValue;
use dataforge_core::models::types::DataType;

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

    match base {
        "tinyint" | "smallint" => DataType::SmallInt,
        "mediumint" | "int" | "integer" => DataType::Integer,
        "bigint" => DataType::BigInt,
        "float" => DataType::Float,
        "double" | "real" => DataType::Double,
        "decimal" | "numeric" | "dec" => DataType::Decimal {
            precision: None,
            scale: None,
        },
        "bit" | "bool" | "boolean" => DataType::Boolean,
        "char" => DataType::Char(None),
        "varchar" => DataType::Varchar(None),
        "tinytext" | "text" | "mediumtext" | "longtext" => DataType::Text,
        "tinyblob" | "blob" | "mediumblob" | "longblob" | "binary" | "varbinary" => DataType::Blob,
        "date" => DataType::Date,
        "time" => DataType::Time,
        "datetime" | "timestamp" => DataType::Timestamp,
        "year" => DataType::Integer,
        "json" => DataType::Json,
        "enum" => DataType::Enum {
            name: String::new(),
            values: vec![],
        },
        "set" => DataType::Text,
        _ => DataType::Unknown(native_type.to_string()),
    }
}

pub fn mysql_value_to_cell(row: &mysql_async::Row, index: usize) -> CellValue {
    use mysql_async::Value;

    match row.as_ref(index) {
        Some(Value::NULL) | None => CellValue::Null,
        Some(Value::Int(n)) => CellValue::Integer(*n),
        Some(Value::UInt(n)) => CellValue::Integer(*n as i64),
        Some(Value::Float(n)) => CellValue::Float(*n as f64),
        Some(Value::Double(n)) => CellValue::Float(*n),
        Some(Value::Bytes(b)) => match String::from_utf8(b.clone()) {
            Ok(s) => CellValue::Text(s),
            Err(_) => CellValue::Bytes {
                size: b.len() as u64,
                preview: format!("0x{}", hex_preview(b, 32)),
            },
        },
        Some(Value::Date(y, m, d, h, min, s, _us)) => CellValue::DateTime(format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            y, m, d, h, min, s
        )),
        Some(Value::Time(neg, d, h, min, s, _us)) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = *d * 24 + (*h as u32);
            CellValue::Time(format!("{}{:02}:{:02}:{:02}", sign, total_h, min, s))
        }
    }
}

fn hex_preview(bytes: &[u8], max_chars: usize) -> String {
    let max_bytes = max_chars / 2;
    bytes
        .iter()
        .take(max_bytes)
        .map(|b| format!("{:02x}", b))
        .collect()
}
