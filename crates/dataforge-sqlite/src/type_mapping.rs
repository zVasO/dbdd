use dataforge_core::models::types::DataType;

pub fn map_sqlite_type(native_type: &str) -> DataType {
    let lower = native_type.to_lowercase();
    match lower.as_str() {
        "integer" | "int" => DataType::Integer,
        "real" | "float" | "double" => DataType::Double,
        "text" | "varchar" | "char" => DataType::Text,
        "blob" => DataType::Blob,
        "boolean" | "bool" => DataType::Boolean,
        "date" => DataType::Date,
        "datetime" | "timestamp" => DataType::Timestamp,
        _ => DataType::Unknown(native_type.to_string()),
    }
}
