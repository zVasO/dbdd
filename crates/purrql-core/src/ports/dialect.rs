use crate::models::schema::TableRef;
use crate::models::types::DataType;

pub trait QueryDialect: Send + Sync {
    fn quote_identifier(&self, identifier: &str) -> String;
    fn limit_offset_clause(&self, limit: u64, offset: u64) -> String;
    fn build_select_all(&self, table: &TableRef, limit: u64, offset: u64) -> String;
    fn build_count(&self, table: &TableRef) -> String;
    fn map_native_type(&self, native_type: &str) -> DataType;
}
