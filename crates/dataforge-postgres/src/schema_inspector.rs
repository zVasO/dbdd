use std::sync::Arc;

use async_trait::async_trait;

use dataforge_core::error::Result;
use std::collections::BTreeMap;

use dataforge_core::models::query::{CellValue, QueryResult, ResultType};
use dataforge_core::models::schema::*;
use dataforge_core::ports::connection::DatabaseConnection;
use dataforge_core::ports::schema::SchemaInspector;

fn pg_fk_action(c: &str) -> FkAction {
    match c {
        "c" => FkAction::Cascade,
        "n" => FkAction::SetNull,
        "d" => FkAction::SetDefault,
        "r" => FkAction::Restrict,
        _ => FkAction::NoAction, // "a" = no action
    }
}

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
        // Use pg_catalog directly instead of information_schema + pg_total_relation_size()
        // pg_class.relpages * 8192 gives a fast size estimate without per-table syscalls
        let sql = "SELECT c.relname AS name, \
             CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type, \
             c.reltuples::bigint AS row_count_estimate, \
             (c.relpages::bigint * 8192) AS size_bytes, \
             obj_description(c.oid) AS comment \
             FROM pg_catalog.pg_class c \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 \
             AND c.relkind IN ('r', 'v', 'm', 'p') \
             ORDER BY c.relname";
        let result = self
            .conn
            .execute_with_params(sql, &[CellValue::Text(schema_name.to_string())])
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
                CellValue::Integer(n) => {
                    if *n < 0 { None } else { Some(*n as u64) }
                }
                _ => None,
            };
            let size_bytes = match &row.cells[3] {
                CellValue::Integer(n) => {
                    if *n <= 0 { None } else { Some(*n as u64) }
                }
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

        // Single query using pg_catalog (much faster than information_schema)
        let col_sql = "SELECT a.attname AS name, \
             format_type(a.atttypid, a.atttypmod) AS data_type, \
             NOT a.attnotnull AS nullable, \
             pg_get_expr(d.adbin, d.adrelid) AS default_value, \
             a.attnum AS ordinal_position, \
             col_description(c.oid, a.attnum) AS comment, \
             COALESCE(i.indisprimary, false) AS is_primary_key \
             FROM pg_catalog.pg_attribute a \
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             LEFT JOIN pg_catalog.pg_index i ON i.indrelid = a.attrelid AND i.indisprimary AND a.attnum = ANY(i.indkey) \
             WHERE n.nspname = $1 AND c.relname = $2 \
             AND a.attnum > 0 AND NOT a.attisdropped \
             ORDER BY a.attnum";
        let col_result = self
            .conn
            .execute_with_params(
                col_sql,
                &[
                    CellValue::Text(schema_name.to_string()),
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

        // --- Indexes ---
        let idx_sql = "SELECT ic.relname AS index_name, \
             a.attname AS column_name, \
             ix.indisunique AS is_unique, \
             ix.indisprimary AS is_primary, \
             am.amname AS index_type \
             FROM pg_catalog.pg_index ix \
             JOIN pg_catalog.pg_class t ON t.oid = ix.indrelid \
             JOIN pg_catalog.pg_class ic ON ic.oid = ix.indexrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_catalog.pg_am am ON am.oid = ic.relam \
             CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord) \
             JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.attnum \
             WHERE n.nspname = $1 AND t.relname = $2 \
             ORDER BY ic.relname, u.ord";
        let idx_result = self
            .conn
            .execute_with_params(
                idx_sql,
                &[
                    CellValue::Text(schema_name.to_string()),
                    CellValue::Text(table.table.clone()),
                ],
            )
            .await
            .unwrap_or_else(|_| QueryResult {
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
            if row.cells.len() < 5 {
                continue;
            }
            let name = match &row.cells[0] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let col = match &row.cells[1] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let is_unique = match &row.cells[2] {
                CellValue::Boolean(b) => *b,
                CellValue::Integer(n) => *n != 0,
                _ => false,
            };
            let is_primary = match &row.cells[3] {
                CellValue::Boolean(b) => *b,
                CellValue::Integer(n) => *n != 0,
                _ => false,
            };
            let idx_type = match &row.cells[4] {
                CellValue::Text(s) => s.clone(),
                _ => "btree".to_string(),
            };
            let entry = idx_map
                .entry(name)
                .or_insert_with(|| (vec![], is_unique, is_primary, idx_type));
            entry.0.push(col);
        }
        let indexes: Vec<IndexInfo> = idx_map
            .into_iter()
            .map(|(name, (columns, is_unique, is_primary, index_type))| IndexInfo {
                name,
                columns,
                is_unique,
                is_primary,
                index_type,
            })
            .collect();

        // --- Foreign Keys ---
        let fk_sql = "SELECT con.conname AS name, \
             a.attname AS column_name, \
             fn.nspname AS ref_schema, \
             fc.relname AS ref_table, \
             fa.attname AS ref_column, \
             con.confupdtype, con.confdeltype \
             FROM pg_catalog.pg_constraint con \
             JOIN pg_catalog.pg_class t ON t.oid = con.conrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
             JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid \
             JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace \
             CROSS JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS u(local_attnum, ref_attnum, ord) \
             JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = u.local_attnum \
             JOIN pg_catalog.pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = u.ref_attnum \
             WHERE con.contype = 'f' AND n.nspname = $1 AND t.relname = $2 \
             ORDER BY con.conname, u.ord";
        let fk_result = self
            .conn
            .execute_with_params(
                fk_sql,
                &[
                    CellValue::Text(schema_name.to_string()),
                    CellValue::Text(table.table.clone()),
                ],
            )
            .await
            .unwrap_or_else(|_| QueryResult {
                query_id: uuid::Uuid::new_v4(),
                columns: vec![],
                rows: vec![],
                total_rows: Some(0),
                affected_rows: None,
                execution_time_ms: 0,
                warnings: vec![],
                result_type: ResultType::Select,
            });

        let mut fk_map: BTreeMap<
            String,
            (Vec<String>, String, String, Vec<String>, String, String),
        > = BTreeMap::new();
        for row in &fk_result.rows {
            if row.cells.len() < 7 {
                continue;
            }
            let name = match &row.cells[0] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let col = match &row.cells[1] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let ref_schema = match &row.cells[2] {
                CellValue::Text(s) => s.clone(),
                _ => String::new(),
            };
            let ref_table = match &row.cells[3] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let ref_col = match &row.cells[4] {
                CellValue::Text(s) => s.clone(),
                _ => continue,
            };
            let upd_type = match &row.cells[5] {
                CellValue::Text(s) => s.clone(),
                _ => "a".to_string(),
            };
            let del_type = match &row.cells[6] {
                CellValue::Text(s) => s.clone(),
                _ => "a".to_string(),
            };
            let entry = fk_map
                .entry(name)
                .or_insert_with(|| (vec![], ref_schema, ref_table, vec![], upd_type, del_type));
            entry.0.push(col);
            entry.3.push(ref_col);
        }
        let foreign_keys: Vec<ForeignKeyInfo> = fk_map
            .into_iter()
            .map(
                |(name, (columns, ref_schema, ref_table, ref_cols, on_update, on_delete))| {
                    ForeignKeyInfo {
                        name,
                        columns,
                        referenced_table: TableRef {
                            database: None,
                            schema: Some(ref_schema),
                            table: ref_table,
                        },
                        referenced_columns: ref_cols,
                        on_update: pg_fk_action(&on_update),
                        on_delete: pg_fk_action(&on_delete),
                    }
                },
            )
            .collect();

        // --- Constraints ---
        let cst_sql = "SELECT con.conname AS name, \
             con.contype, \
             pg_get_constraintdef(con.oid) AS definition, \
             ARRAY(SELECT a.attname FROM pg_catalog.pg_attribute a \
                   WHERE a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)) AS col_names \
             FROM pg_catalog.pg_constraint con \
             JOIN pg_catalog.pg_class t ON t.oid = con.conrelid \
             JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace \
             WHERE n.nspname = $1 AND t.relname = $2 \
             ORDER BY con.conname";
        let cst_result = self
            .conn
            .execute_with_params(
                cst_sql,
                &[
                    CellValue::Text(schema_name.to_string()),
                    CellValue::Text(table.table.clone()),
                ],
            )
            .await
            .unwrap_or_else(|_| QueryResult {
                query_id: uuid::Uuid::new_v4(),
                columns: vec![],
                rows: vec![],
                total_rows: Some(0),
                affected_rows: None,
                execution_time_ms: 0,
                warnings: vec![],
                result_type: ResultType::Select,
            });

        let constraints: Vec<ConstraintInfo> = cst_result
            .rows
            .iter()
            .filter_map(|row| {
                if row.cells.len() < 4 {
                    return None;
                }
                let name = match &row.cells[0] {
                    CellValue::Text(s) => s.clone(),
                    _ => return None,
                };
                let contype = match &row.cells[1] {
                    CellValue::Text(s) => s.clone(),
                    _ => return None,
                };
                let definition = match &row.cells[2] {
                    CellValue::Text(s) => Some(s.clone()),
                    _ => None,
                };
                // col_names comes as an Array or Text like "{col1,col2}"
                let columns = match &row.cells[3] {
                    CellValue::Text(s) => s
                        .trim_matches(|c| c == '{' || c == '}')
                        .split(',')
                        .filter(|s| !s.is_empty())
                        .map(|s| s.to_string())
                        .collect(),
                    CellValue::Array(items) => items
                        .iter()
                        .filter_map(|item| match item {
                            CellValue::Text(s) => Some(s.clone()),
                            _ => None,
                        })
                        .collect(),
                    _ => vec![],
                };
                let constraint_type = match contype.as_str() {
                    "p" => ConstraintType::PrimaryKey,
                    "u" => ConstraintType::Unique,
                    "c" => ConstraintType::Check,
                    "x" => ConstraintType::Exclusion,
                    "f" => ConstraintType::ForeignKey,
                    _ => ConstraintType::Check,
                };
                Some(ConstraintInfo {
                    name,
                    constraint_type,
                    columns,
                    definition,
                })
            })
            .collect();

        // --- Table Comment ---
        let comment_sql = "SELECT obj_description(c.oid) FROM pg_catalog.pg_class c \
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relname = $2";
        let comment = self
            .conn
            .execute_with_params(
                comment_sql,
                &[
                    CellValue::Text(schema_name.to_string()),
                    CellValue::Text(table.table.clone()),
                ],
            )
            .await
            .ok()
            .and_then(|r| {
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
