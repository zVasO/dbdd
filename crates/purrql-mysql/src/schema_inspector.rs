use std::collections::BTreeMap;
use std::sync::Arc;

use async_trait::async_trait;

use purrql_core::error::{PurrqlError, Result};
use purrql_core::models::query::{CellValue, QueryResult, ResultType};
use purrql_core::models::schema::*;
use purrql_core::ports::connection::DatabaseConnection;
use purrql_core::ports::schema::SchemaInspector;

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
            PurrqlError::SchemaInspection("Database name required for MySQL".to_string())
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

        // --- Indexes ---
        let idx_sql = "SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, INDEX_TYPE \
             FROM information_schema.STATISTICS \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
             ORDER BY INDEX_NAME, SEQ_IN_INDEX";
        let idx_result = self.conn.execute_with_params(
            idx_sql,
            &[CellValue::Text(db.to_string()), CellValue::Text(table.table.clone())],
        ).await.unwrap_or_else(|_| QueryResult {
            query_id: uuid::Uuid::new_v4(),
            columns: vec![],
            rows: vec![],
            total_rows: Some(0),
            affected_rows: None,
            execution_time_ms: 0,
            warnings: vec![],
            result_type: ResultType::Select,
        });

        let mut idx_map: BTreeMap<String, (Vec<String>, bool, bool, String)> = BTreeMap::new();
        for row in &idx_result.rows {
            if row.cells.len() < 4 { continue; }
            let name = match &row.cells[0] { CellValue::Text(s) => s.clone(), _ => continue };
            let col = match &row.cells[1] { CellValue::Text(s) => s.clone(), _ => continue };
            let non_unique = match &row.cells[2] {
                CellValue::Integer(n) => *n != 0,
                CellValue::Boolean(b) => *b,
                _ => true,
            };
            let idx_type = match &row.cells[3] { CellValue::Text(s) => s.clone(), _ => "BTREE".to_string() };
            let entry = idx_map.entry(name.clone()).or_insert_with(|| (vec![], !non_unique, name == "PRIMARY", idx_type));
            entry.0.push(col);
        }
        let indexes: Vec<IndexInfo> = idx_map.into_iter().map(|(name, (columns, is_unique, is_primary, index_type))| {
            IndexInfo { name, columns, is_unique, is_primary, index_type }
        }).collect();

        // --- Foreign Keys ---
        let fk_sql = "SELECT kcu.CONSTRAINT_NAME, kcu.COLUMN_NAME, \
             kcu.REFERENCED_TABLE_SCHEMA, kcu.REFERENCED_TABLE_NAME, kcu.REFERENCED_COLUMN_NAME, \
             rc.UPDATE_RULE, rc.DELETE_RULE \
             FROM information_schema.KEY_COLUMN_USAGE kcu \
             JOIN information_schema.REFERENTIAL_CONSTRAINTS rc \
               ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA \
               AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME \
             WHERE kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? \
               AND kcu.REFERENCED_TABLE_NAME IS NOT NULL \
             ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";
        let fk_result = self.conn.execute_with_params(
            fk_sql,
            &[CellValue::Text(db.to_string()), CellValue::Text(table.table.clone())],
        ).await.unwrap_or_else(|_| QueryResult {
            query_id: uuid::Uuid::new_v4(),
            columns: vec![],
            rows: vec![],
            total_rows: Some(0),
            affected_rows: None,
            execution_time_ms: 0,
            warnings: vec![],
            result_type: ResultType::Select,
        });

        let mut fk_map: BTreeMap<String, (Vec<String>, String, String, Vec<String>, String, String)> = BTreeMap::new();
        for row in &fk_result.rows {
            if row.cells.len() < 7 { continue; }
            let name = match &row.cells[0] { CellValue::Text(s) => s.clone(), _ => continue };
            let col = match &row.cells[1] { CellValue::Text(s) => s.clone(), _ => continue };
            let ref_schema = match &row.cells[2] { CellValue::Text(s) => s.clone(), _ => String::new() };
            let ref_table = match &row.cells[3] { CellValue::Text(s) => s.clone(), _ => continue };
            let ref_col = match &row.cells[4] { CellValue::Text(s) => s.clone(), _ => continue };
            let on_update = match &row.cells[5] { CellValue::Text(s) => s.clone(), _ => "NO ACTION".to_string() };
            let on_delete = match &row.cells[6] { CellValue::Text(s) => s.clone(), _ => "NO ACTION".to_string() };
            let entry = fk_map.entry(name).or_insert_with(|| (vec![], ref_schema, ref_table, vec![], on_update, on_delete));
            entry.0.push(col);
            entry.3.push(ref_col);
        }

        let foreign_keys: Vec<ForeignKeyInfo> = fk_map.into_iter().map(|(name, (columns, ref_schema, ref_table, ref_cols, on_update, on_delete))| {
            ForeignKeyInfo {
                name,
                columns,
                referenced_table: TableRef {
                    database: Some(ref_schema),
                    schema: None,
                    table: ref_table,
                },
                referenced_columns: ref_cols,
                on_update: parse_fk_action(&on_update),
                on_delete: parse_fk_action(&on_delete),
            }
        }).collect();

        // --- Constraints ---
        let cst_sql = "SELECT tc.CONSTRAINT_NAME, tc.CONSTRAINT_TYPE, kcu.COLUMN_NAME \
             FROM information_schema.TABLE_CONSTRAINTS tc \
             LEFT JOIN information_schema.KEY_COLUMN_USAGE kcu \
               ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA \
               AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME \
               AND kcu.TABLE_NAME = tc.TABLE_NAME \
             WHERE tc.TABLE_SCHEMA = ? AND tc.TABLE_NAME = ? \
             ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION";
        let cst_result = self.conn.execute_with_params(
            cst_sql,
            &[CellValue::Text(db.to_string()), CellValue::Text(table.table.clone())],
        ).await.unwrap_or_else(|_| QueryResult {
            query_id: uuid::Uuid::new_v4(),
            columns: vec![],
            rows: vec![],
            total_rows: Some(0),
            affected_rows: None,
            execution_time_ms: 0,
            warnings: vec![],
            result_type: ResultType::Select,
        });

        let mut cst_map: BTreeMap<String, (ConstraintType, Vec<String>)> = BTreeMap::new();
        for row in &cst_result.rows {
            if row.cells.len() < 3 { continue; }
            let name = match &row.cells[0] { CellValue::Text(s) => s.clone(), _ => continue };
            let ctype_str = match &row.cells[1] { CellValue::Text(s) => s.clone(), _ => continue };
            let col = match &row.cells[2] { CellValue::Text(s) => Some(s.clone()), _ => None };
            let ctype = match ctype_str.as_str() {
                "PRIMARY KEY" => ConstraintType::PrimaryKey,
                "UNIQUE" => ConstraintType::Unique,
                "CHECK" => ConstraintType::Check,
                "FOREIGN KEY" => ConstraintType::ForeignKey,
                _ => ConstraintType::Check,
            };
            let entry = cst_map.entry(name).or_insert_with(|| (ctype, vec![]));
            if let Some(c) = col { entry.1.push(c); }
        }
        let constraints: Vec<ConstraintInfo> = cst_map.into_iter().map(|(name, (constraint_type, columns))| {
            ConstraintInfo { name, constraint_type, columns, definition: None }
        }).collect();

        // --- Table Comment ---
        let comment_sql = "SELECT TABLE_COMMENT FROM information_schema.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?";
        let comment_result = self.conn.execute_with_params(
            comment_sql,
            &[CellValue::Text(db.to_string()), CellValue::Text(table.table.clone())],
        ).await.ok();
        let comment = comment_result.and_then(|r| {
            r.rows.first().and_then(|row| match &row.cells[0] {
                CellValue::Text(s) if !s.is_empty() => Some(s.clone()),
                _ => None,
            })
        });

        Ok(TableStructure {
            table_ref: table.clone(),
            columns,
            primary_key,
            indexes,
            foreign_keys,
            constraints,
            comment,
        })
    }
}

fn parse_fk_action(s: &str) -> FkAction {
    match s {
        "CASCADE" => FkAction::Cascade,
        "SET NULL" => FkAction::SetNull,
        "SET DEFAULT" => FkAction::SetDefault,
        "RESTRICT" => FkAction::Restrict,
        _ => FkAction::NoAction,
    }
}
