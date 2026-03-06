use std::sync::Arc;

use async_trait::async_trait;

use dataforge_core::error::Result;
use dataforge_core::models::query::CellValue;
use dataforge_core::models::schema::*;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::schema::SchemaInspector;

pub struct PostgresSchemaInspector {
    conn: Arc<dyn DatabaseConnection>,
}

impl PostgresSchemaInspector {
    pub fn new(conn: Arc<dyn DatabaseConnection>) -> Self {
        Self { conn }
    }
}

#[async_trait]
impl SchemaInspector for PostgresSchemaInspector {
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>> {
        let result = self
            .conn
            .execute(
                "SELECT d.datname AS name, \
                 pg_database_size(d.datname) AS size_bytes, \
                 pg_encoding_to_char(d.encoding) AS encoding \
                 FROM pg_database d \
                 WHERE d.datistemplate = false \
                 AND d.datname NOT IN ('postgres') \
                 ORDER BY d.datname",
            )
            .await?;

        let mut databases = Vec::new();
        for row in &result.rows {
            if row.cells.len() < 3 {
                continue;
            }
            let name = match &row.cells[0] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let size_bytes = match &row.cells[1] {
                CellValue::Integer(n) => Some(*n as u64),
                CellValue::Float(n) => Some(*n as u64),
                _ => None,
            };
            let encoding = match &row.cells[2] {
                CellValue::Text(s) => Some(s.clone()),
                _ => None,
            };
            databases.push(DatabaseInfo {
                name,
                size_bytes,
                encoding,
            });
        }
        Ok(databases)
    }

    async fn list_schemas(&self, _database: &str) -> Result<Vec<SchemaInfo>> {
        let result = self
            .conn
            .execute(
                "SELECT schema_name \
                 FROM information_schema.schemata \
                 WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
                 AND schema_name NOT LIKE 'pg_temp_%' \
                 AND schema_name NOT LIKE 'pg_toast_temp_%' \
                 ORDER BY schema_name",
            )
            .await?;

        let mut schemas = Vec::new();
        for row in &result.rows {
            if let Some(CellValue::Text(name)) = row.cells.first() {
                schemas.push(SchemaInfo {
                    name: name.clone(),
                    owner: None,
                });
            }
        }
        Ok(schemas)
    }

    async fn list_tables(
        &self,
        _database: &str,
        schema: Option<&str>,
    ) -> Result<Vec<TableInfo>> {
        let schema_name = schema.unwrap_or("public");
        let sql = format!(
            "SELECT t.table_name AS name, \
             t.table_type, \
             COALESCE(s.n_live_tup, 0) AS row_count_estimate, \
             pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::bigint AS size_bytes, \
             obj_description((quote_ident(t.table_schema) || '.' || quote_ident(t.table_name))::regclass) AS comment \
             FROM information_schema.tables t \
             LEFT JOIN pg_stat_user_tables s \
               ON s.schemaname = t.table_schema AND s.relname = t.table_name \
             WHERE t.table_schema = '{}' \
             ORDER BY t.table_name",
            schema_name.replace('\'', "''")
        );
        let result = self.conn.execute(&sql).await?;

        let mut tables = Vec::new();
        for row in &result.rows {
            if row.cells.len() < 5 {
                continue;
            }
            let name = match &row.cells[0] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let table_type_str = match &row.cells[1] {
                CellValue::Text(s) => s.clone(),
                _ => "BASE TABLE".to_string(),
            };
            let table_type = if table_type_str.contains("VIEW") {
                TableType::View
            } else {
                TableType::Table
            };
            let row_count_estimate = match &row.cells[2] {
                CellValue::Integer(n) => Some(*n as u64),
                _ => None,
            };
            let size_bytes = match &row.cells[3] {
                CellValue::Integer(n) => Some(*n as u64),
                _ => None,
            };
            let comment = match &row.cells[4] {
                CellValue::Text(s) if !s.is_empty() => Some(s.clone()),
                _ => None,
            };
            tables.push(TableInfo {
                name,
                table_type,
                row_count_estimate,
                size_bytes,
                comment,
            });
        }
        Ok(tables)
    }

    async fn get_table_structure(&self, table: &TableRef) -> Result<TableStructure> {
        let schema_name = table.schema.as_deref().unwrap_or("public");
        let escaped_schema = schema_name.replace('\'', "''");
        let escaped_table = table.table.replace('\'', "''");

        // Columns
        let col_sql = format!(
            "SELECT c.column_name, c.data_type, c.is_nullable = 'YES' AS nullable, \
             c.column_default, c.ordinal_position::int, \
             pgd.description AS comment, \
             CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_primary_key \
             FROM information_schema.columns c \
             LEFT JOIN pg_catalog.pg_statio_all_tables st \
               ON st.schemaname = c.table_schema AND st.relname = c.table_name \
             LEFT JOIN pg_catalog.pg_description pgd \
               ON pgd.objoid = st.relid AND pgd.objsubid = c.ordinal_position \
             LEFT JOIN ( \
               SELECT kcu.column_name \
               FROM information_schema.table_constraints tc \
               JOIN information_schema.key_column_usage kcu \
                 ON tc.constraint_name = kcu.constraint_name \
                 AND tc.table_schema = kcu.table_schema \
               WHERE tc.constraint_type = 'PRIMARY KEY' \
                 AND tc.table_schema = '{}' AND tc.table_name = '{}' \
             ) pk ON pk.column_name = c.column_name \
             WHERE c.table_schema = '{}' AND c.table_name = '{}' \
             ORDER BY c.ordinal_position",
            escaped_schema, escaped_table, escaped_schema, escaped_table
        );
        let col_result = self.conn.execute(&col_sql).await?;

        let columns: Vec<ColumnInfo> = col_result
            .rows
            .iter()
            .filter_map(|row| {
                if row.cells.len() < 7 {
                    return None;
                }
                let name = match &row.cells[0] {
                    CellValue::Text(s) => s.clone(),
                    _ => return None,
                };
                let data_type = match &row.cells[1] {
                    CellValue::Text(s) => s.clone(),
                    _ => return None,
                };
                let nullable = matches!(&row.cells[2], CellValue::Boolean(true))
                    || matches!(&row.cells[2], CellValue::Integer(n) if *n != 0);
                let default_value = match &row.cells[3] {
                    CellValue::Text(s) => Some(s.clone()),
                    _ => None,
                };
                let ordinal_position = match &row.cells[4] {
                    CellValue::Integer(n) => *n as i32,
                    _ => 0,
                };
                let comment = match &row.cells[5] {
                    CellValue::Text(s) if !s.is_empty() => Some(s.clone()),
                    _ => None,
                };
                let is_primary_key = matches!(&row.cells[6], CellValue::Boolean(true))
                    || matches!(&row.cells[6], CellValue::Integer(n) if *n != 0);

                Some(ColumnInfo {
                    name,
                    data_type: data_type.clone(),
                    mapped_type: crate::type_mapping::map_postgres_type(&data_type),
                    nullable,
                    default_value,
                    is_primary_key,
                    ordinal_position,
                    comment,
                })
            })
            .collect();

        let pk_cols: Vec<String> = columns
            .iter()
            .filter(|c| c.is_primary_key)
            .map(|c| c.name.clone())
            .collect();
        let primary_key = if pk_cols.is_empty() {
            None
        } else {
            Some(PrimaryKeyInfo {
                name: None,
                columns: pk_cols,
            })
        };

        Ok(TableStructure {
            table_ref: table.clone(),
            columns,
            primary_key,
            indexes: vec![],
            foreign_keys: vec![],
            constraints: vec![],
            comment: None,
        })
    }
}
