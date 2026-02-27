use dataforge_core::models::schema::TableRef;
use dataforge_core::models::types::DataType;
use dataforge_core::ports::dialect::QueryDialect;

pub struct PostgresDialect;

impl QueryDialect for PostgresDialect {
    fn quote_identifier(&self, identifier: &str) -> String {
        format!("\"{}\"", identifier.replace('"', "\"\""))
    }
    fn limit_offset_clause(&self, limit: u64, offset: u64) -> String {
        format!("LIMIT {} OFFSET {}", limit, offset)
    }
    fn build_select_all(&self, table: &TableRef, limit: u64, offset: u64) -> String {
        let table_name = if let Some(ref schema) = table.schema {
            format!(
                "{}.{}",
                self.quote_identifier(schema),
                self.quote_identifier(&table.table)
            )
        } else {
            self.quote_identifier(&table.table)
        };
        format!(
            "SELECT * FROM {} {}",
            table_name,
            self.limit_offset_clause(limit, offset)
        )
    }
    fn build_count(&self, table: &TableRef) -> String {
        let table_name = if let Some(ref schema) = table.schema {
            format!(
                "{}.{}",
                self.quote_identifier(schema),
                self.quote_identifier(&table.table)
            )
        } else {
            self.quote_identifier(&table.table)
        };
        format!("SELECT COUNT(*) FROM {}", table_name)
    }
    fn map_native_type(&self, native_type: &str) -> DataType {
        crate::type_mapping::map_postgres_type(native_type)
    }
}
