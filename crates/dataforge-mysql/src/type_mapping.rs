use dataforge_core::models::query::CellValue;
use dataforge_core::models::types::DataType;

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
