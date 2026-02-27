use dataforge_core::models::types::DataType;

pub fn map_postgres_type(native_type: &str) -> DataType {
    let lower = native_type.to_lowercase();
    match lower.as_str() {
        "smallint" | "int2" => DataType::SmallInt,
        "integer" | "int" | "int4" => DataType::Integer,
        "bigint" | "int8" => DataType::BigInt,
        "real" | "float4" => DataType::Float,
        "double precision" | "float8" => DataType::Double,
        "numeric" | "decimal" => DataType::Decimal { precision: None, scale: None },
        "serial" => DataType::Serial,
        "bigserial" => DataType::BigSerial,
        "boolean" | "bool" => DataType::Boolean,
        "char" | "character" => DataType::Char(None),
        "varchar" | "character varying" => DataType::Varchar(None),
        "text" => DataType::Text,
        "bytea" => DataType::Bytea,
        "date" => DataType::Date,
        "time" | "time without time zone" => DataType::Time,
        "time with time zone" | "timetz" => DataType::TimeTz,
        "timestamp" | "timestamp without time zone" => DataType::Timestamp,
        "timestamp with time zone" | "timestamptz" => DataType::TimestampTz,
        "interval" => DataType::Interval,
        "json" => DataType::Json,
        "jsonb" => DataType::Jsonb,
        "uuid" => DataType::Uuid,
        "inet" => DataType::Inet,
        "cidr" => DataType::Cidr,
        "macaddr" => DataType::MacAddr,
        "point" => DataType::Point,
        "line" => DataType::Line,
        "box" => DataType::Box,
        "circle" => DataType::Circle,
        _ => DataType::Unknown(native_type.to_string()),
    }
}
