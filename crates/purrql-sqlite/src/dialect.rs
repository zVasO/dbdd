use purrql_core::models::schema::TableRef;
use purrql_core::models::types::DataType;
use purrql_core::ports::dialect::QueryDialect;

pub struct SqliteDialect;

impl QueryDialect for SqliteDialect {
    fn quote_identifier(&self, identifier: &str) -> String {
        format!("\"{}\"", identifier.replace('"', "\"\""))
    }
    fn limit_offset_clause(&self, limit: u64, offset: u64) -> String {
        format!("LIMIT {} OFFSET {}", limit, offset)
    }
    fn build_select_all(&self, table: &TableRef, limit: u64, offset: u64) -> String {
        format!(
            "SELECT * FROM {} {}",
            self.quote_identifier(&table.table),
            self.limit_offset_clause(limit, offset)
        )
    }
    fn build_count(&self, table: &TableRef) -> String {
        format!("SELECT COUNT(*) FROM {}", self.quote_identifier(&table.table))
    }
    fn map_native_type(&self, native_type: &str) -> DataType {
        crate::type_mapping::map_sqlite_type(native_type)
    }
}
