use std::collections::HashMap;
use std::sync::LazyLock;

use dataforge_core::models::types::DataType;

static PG_TYPE_MAP: LazyLock<HashMap<&'static str, DataType>> = LazyLock::new(|| {
    HashMap::from([
        ("smallint", DataType::SmallInt),
        ("int2", DataType::SmallInt),
        ("integer", DataType::Integer),
        ("int", DataType::Integer),
        ("int4", DataType::Integer),
        ("bigint", DataType::BigInt),
        ("int8", DataType::BigInt),
        ("real", DataType::Float),
        ("float4", DataType::Float),
        ("double precision", DataType::Double),
        ("float8", DataType::Double),
        ("numeric", DataType::Decimal { precision: None, scale: None }),
        ("decimal", DataType::Decimal { precision: None, scale: None }),
        ("serial", DataType::Serial),
        ("bigserial", DataType::BigSerial),
        ("boolean", DataType::Boolean),
        ("bool", DataType::Boolean),
        ("char", DataType::Char(None)),
        ("character", DataType::Char(None)),
        ("varchar", DataType::Varchar(None)),
        ("character varying", DataType::Varchar(None)),
        ("text", DataType::Text),
        ("bytea", DataType::Bytea),
        ("date", DataType::Date),
        ("time", DataType::Time),
        ("time without time zone", DataType::Time),
        ("time with time zone", DataType::TimeTz),
        ("timetz", DataType::TimeTz),
        ("timestamp", DataType::Timestamp),
        ("timestamp without time zone", DataType::Timestamp),
        ("timestamp with time zone", DataType::TimestampTz),
        ("timestamptz", DataType::TimestampTz),
        ("interval", DataType::Interval),
        ("json", DataType::Json),
        ("jsonb", DataType::Jsonb),
        ("uuid", DataType::Uuid),
        ("inet", DataType::Inet),
        ("cidr", DataType::Cidr),
        ("macaddr", DataType::MacAddr),
        ("point", DataType::Point),
        ("line", DataType::Line),
        ("box", DataType::Box),
        ("circle", DataType::Circle),
    ])
});

pub fn map_postgres_type(native_type: &str) -> DataType {
    let lower = native_type.to_lowercase();
    PG_TYPE_MAP
        .get(lower.as_str())
        .cloned()
        .unwrap_or_else(|| DataType::Unknown(native_type.to_string()))
}
