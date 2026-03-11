use std::sync::Arc;

use async_trait::async_trait;

use dataforge_core::error::{DataForgeError, Result};
use dataforge_core::models::query::CellValue;
use dataforge_core::models::schema::*;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::schema::SchemaInspector;

pub struct MySqlSchemaInspector {
    conn: Arc<dyn DatabaseConnection>,
}

impl MySqlSchemaInspector {
    pub fn new(conn: Arc<dyn DatabaseConnection>) -> Self {
        Self { conn }
    }
}

#[async_trait]
impl SchemaInspector for MySqlSchemaInspector {
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>> {
        let result = self
            .conn
            .execute(
                "SELECT SCHEMA_NAME AS name, \
                 ROUND(SUM(DATA_LENGTH + INDEX_LENGTH)) AS size_bytes, \
                 DEFAULT_CHARACTER_SET_NAME AS encoding \
                 FROM information_schema.SCHEMATA s \
                 LEFT JOIN information_schema.TABLES t ON s.SCHEMA_NAME = t.TABLE_SCHEMA \
                 WHERE SCHEMA_NAME NOT IN ('information_schema', 'performance_schema', 'mysql', 'sys') \
                 GROUP BY SCHEMA_NAME, DEFAULT_CHARACTER_SET_NAME \
                 ORDER BY SCHEMA_NAME",
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
        Ok(vec![])
    }

    async fn list_tables(&self, database: &str, _schema: Option<&str>) -> Result<Vec<TableInfo>> {
        let sql = "SELECT TABLE_NAME AS name, \
             TABLE_TYPE AS table_type, \
             TABLE_ROWS AS row_count_estimate, \
             DATA_LENGTH + INDEX_LENGTH AS size_bytes, \
             TABLE_COMMENT AS comment \
             FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? \
             ORDER BY TABLE_NAME";
        let result = self
            .conn
            .execute_with_params(sql, &[CellValue::Text(database.to_string())])
            .await?;

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
        let db = table.database.as_deref().ok_or_else(|| {
            DataForgeError::SchemaInspection("Database name required for MySQL".to_string())
        })?;

        let col_sql = "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE = 'YES', \
             COLUMN_DEFAULT, ORDINAL_POSITION, COLUMN_COMMENT, COLUMN_KEY = 'PRI' \
             FROM information_schema.COLUMNS \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
             ORDER BY ORDINAL_POSITION";
        let col_result = self
            .conn
            .execute_with_params(
                col_sql,
                &[
                    CellValue::Text(db.to_string()),
                    CellValue::Text(table.table.clone()),
                ],
            )
            .await?;

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
                let nullable = matches!(&row.cells[2], CellValue::Integer(n) if *n != 0)
                    || matches!(&row.cells[2], CellValue::Boolean(true));
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
                let is_primary_key = matches!(&row.cells[6], CellValue::Integer(n) if *n != 0)
                    || matches!(&row.cells[6], CellValue::Boolean(true));

                Some(ColumnInfo {
                    name,
                    data_type: data_type.clone(),
                    mapped_type: crate::type_mapping::map_mysql_type(&data_type),
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
                name: Some("PRIMARY".to_string()),
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
