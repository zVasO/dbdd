use std::io::{BufRead, Read};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use rfd::AsyncFileDialog;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use purrql_core::error::IpcError;
use purrql_core::ports::dialect::QueryDialect;

use crate::commands::query::{
    run_statements_windowed, summarize, BatchSummary, StatementOutcome, DEFAULT_BATCH_WINDOW,
};
use crate::state::AppState;

/// Rows packed into one INSERT statement, matching the JS import path this
/// replaces.
const ROWS_PER_STATEMENT: usize = 50;

/// Data rows returned with a preview.
const PREVIEW_ROWS: usize = 100;

/// The identifier quote character MySQL uses. It is also how this module tells
/// MySQL apart from the two ANSI-quoting dialects, which is all the two
/// dialect-dependent decisions here — string escaping and table qualification —
/// need to know.
const MYSQL_QUOTE: char = '`';

/// Quote `identifier`, doubling any embedded quote character, for a dialect
/// whose identifier quote is `quote`.
fn quote_ident(identifier: &str, quote: char) -> String {
    let mut out = String::with_capacity(identifier.len() + 2);
    out.push(quote);
    for ch in identifier.chars() {
        if ch == quote {
            out.push(quote);
        }
        out.push(ch);
    }
    out.push(quote);
    out
}

/// Render one mapped cell as a SQL literal.
///
/// Every value goes out as a quoted string for the database to coerce into the
/// column's type, and `None` as an unquoted NULL — parity with the JS
/// `escapeValue` this replaces, which typed nothing either.
///
/// MySQL additionally reads `\` as an escape character inside string literals
/// unless NO_BACKSLASH_ESCAPES is set, so a value ending in one would escape
/// its own closing quote and let the rest of the file be parsed as SQL.
/// Postgres and SQLite take backslashes literally
/// (`standard_conforming_strings`), where doubling the quote is enough.
fn sql_literal(value: Option<&str>, quote: char) -> String {
    let Some(value) = value else {
        return "NULL".to_string();
    };
    let escaped = value.replace('\'', "''");
    let escaped = if quote == MYSQL_QUOTE {
        escaped.replace('\\', "\\\\")
    } else {
        escaped
    };
    format!("'{escaped}'")
}

/// The table an INSERT targets, qualified with `database` when one applies.
fn qualified_table(table: &str, database: Option<&str>, quote: char) -> String {
    match database {
        Some(db) => format!("{}.{}", quote_ident(db, quote), quote_ident(table, quote)),
        None => quote_ident(table, quote),
    }
}

/// Which database, if any, the INSERT should qualify its table with.
///
/// Only MySQL: a MySQL session can write to any database on the server, which
/// is what the JS path's `USE` statement was reaching for (unreliably — it ran
/// as its own statement over a pooled connection, so the INSERTs that followed
/// could land on a different one). A Postgres connection cannot write across
/// databases at all, and its table list comes from the current database's
/// schema regardless of which database the dialog has selected, so qualifying
/// with that name would address a schema that doesn't exist. SQLite has no
/// database to pick.
fn qualifying_database<'a>(database: Option<&'a str>, quote: char) -> Option<&'a str> {
    database.filter(|_| quote == MYSQL_QUOTE)
}

/// One multi-row INSERT covering every row in `rows`.
fn build_insert(
    table: &str,
    database: Option<&str>,
    columns: &[String],
    rows: &[Vec<Option<String>>],
    quote: char,
) -> String {
    let column_list = columns
        .iter()
        .map(|c| quote_ident(c, quote))
        .collect::<Vec<_>>()
        .join(", ");
    let values = rows
        .iter()
        .map(|row| {
            let cells = row
                .iter()
                .map(|v| sql_literal(v.as_deref(), quote))
                .collect::<Vec<_>>()
                .join(", ");
            format!("({cells})")
        })
        .collect::<Vec<_>>()
        .join(",\n");

    format!(
        "INSERT INTO {} ({}) VALUES\n{}",
        qualified_table(table, database, quote),
        column_list,
        values
    )
}

/// A cell's value, or `None` where it stands for SQL NULL.
///
/// Empty cells and the `null` / `\N` markers become NULL, exactly as the JS
/// `escapeValue` this replaces treated them.
fn cell_value(cell: &str) -> Option<String> {
    if cell.is_empty() || cell.eq_ignore_ascii_case("null") || cell.eq_ignore_ascii_case("\\n") {
        None
    } else {
        Some(cell.to_string())
    }
}

/// The mapped columns of one CSV record, in target-column order.
///
/// `mapping[i]` is the CSV column index feeding target column `i`; a skipped
/// CSV column simply never appears in it. The reader runs with
/// `flexible(true)`, so a record shorter than the header reaches here and
/// yields `None` for every column it doesn't reach.
fn map_record(record: &csv::StringRecord, mapping: &[usize]) -> Vec<Option<String>> {
    mapping
        .iter()
        .map(|&idx| record.get(idx).and_then(cell_value))
        .collect()
}

/// The delimiter a file uses, judged from its header line.
///
/// The JS path sniffed the whole file for any tab character, so a single tab
/// inside one quoted value made it read a CSV as a TSV.
fn detect_delimiter(header_line: &str) -> u8 {
    if header_line.matches('\t').count() > header_line.matches(',').count() {
        b'\t'
    } else {
        b','
    }
}

/// Extrapolate the file's row count from the bytes its sampled rows occupied.
///
/// Approximate by construction: it exists to tell the dialog whether the user
/// picked a thousand-row file or a million-row one, and nothing depends on it.
/// A sample that reached the end of the file is the exact count instead.
fn estimate_total_rows(
    rows_sampled: u64,
    bytes_sampled: u64,
    file_len: u64,
    exhausted: bool,
) -> Option<u64> {
    if exhausted {
        return Some(rows_sampled);
    }
    if rows_sampled == 0 || bytes_sampled == 0 || file_len <= bytes_sampled {
        return None;
    }
    Some(rows_sampled.saturating_mul(file_len) / bytes_sampled)
}

/// `CREATE TABLE IF NOT EXISTS` covering the mapped columns.
///
/// The import types nothing — every value is sent as a quoted string for the
/// database to coerce — so a table it creates has nothing better to say about
/// its columns than that they hold text.
fn build_create_table(
    table: &str,
    database: Option<&str>,
    columns: &[String],
    quote: char,
) -> String {
    let definitions = columns
        .iter()
        .map(|c| format!("{} TEXT", quote_ident(c, quote)))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "CREATE TABLE IF NOT EXISTS {} ({})",
        qualified_table(table, database, quote),
        definitions
    )
}

/// Split a per-CSV-column mapping into the target column names and the CSV
/// indices feeding them, both in target order. Unmapped CSV columns drop out.
fn split_mapping(mapping: &[Option<String>]) -> (Vec<String>, Vec<usize>) {
    mapping
        .iter()
        .enumerate()
        .filter_map(|(index, target)| target.as_ref().map(|t| (t.clone(), index)))
        .unzip()
}

/// The header row and first rows of a CSV file, with the bytes they occupied.
struct Sample {
    headers: Vec<String>,
    rows: Vec<Vec<String>>,
    bytes_read: u64,
    exhausted: bool,
}

/// Read the header plus up to `limit` data rows.
fn read_sample<R: Read>(source: R, delimiter: u8, limit: usize) -> csv::Result<Sample> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_reader(source);
    let headers = reader.headers()?.iter().map(str::to_string).collect();

    let mut rows: Vec<Vec<String>> = Vec::with_capacity(limit);
    let mut record = csv::StringRecord::new();
    let mut bytes_read = reader.position().byte();
    let exhausted = loop {
        if rows.len() == limit {
            // One record past the sample says whether the file continues,
            // without its bytes skewing the extrapolation.
            break !reader.read_record(&mut record)?;
        }
        if !reader.read_record(&mut record)? {
            break true;
        }
        rows.push(record.iter().map(str::to_string).collect());
        bytes_read = reader.position().byte();
    };

    Ok(Sample {
        headers,
        rows,
        bytes_read,
        exhausted,
    })
}

/// Bytes read looking for the header line. A file with no line break at all is
/// still one CSV row, and sniffing its delimiter must not pull all of it in.
const HEADER_SNIFF_BYTES: u64 = 64 * 1024;

fn read_error(error: std::io::Error) -> IpcError {
    IpcError::from(format!("Could not read the file: {error}"))
}

/// The first line of `path`, for delimiter sniffing.
fn first_line(path: &Path) -> Result<String, IpcError> {
    let file = std::fs::File::open(path).map_err(read_error)?;
    let mut line = Vec::new();
    std::io::BufReader::new(file.take(HEADER_SNIFF_BYTES))
        .read_until(b'\n', &mut line)
        .map_err(read_error)?;
    Ok(String::from_utf8_lossy(&line).into_owned())
}

/// Open `path` as a CSV reader, with `flexible(true)` so a ragged row is
/// padded rather than aborting the import.
fn open_reader(path: &Path) -> Result<csv::Reader<std::fs::File>, IpcError> {
    let delimiter = detect_delimiter(&first_line(path)?);
    csv::ReaderBuilder::new()
        .delimiter(delimiter)
        .flexible(true)
        .from_path(path)
        .map_err(|e| IpcError::from(format!("Could not read the file: {e}")))
}

/// A file a preview handed out a token for, waiting for its import to run.
pub struct ImportFile {
    path: PathBuf,
    picked: u64,
}

pub type ImportFiles = DashMap<Uuid, ImportFile>;

/// Previews held before the oldest is evicted.
///
/// A preview the user abandons — picks a file, then closes the dialog — leaves
/// an entry nobody will remove, so the map is bounded rather than trusting the
/// frontend to always release one. Each entry is a path and a counter, so the
/// bound is hygiene rather than relief from memory pressure.
const MAX_PENDING_PREVIEWS: usize = 8;

static PICK_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Hand out a token standing for `path`, evicting the oldest preview if the
/// map is already full.
fn remember_file(files: &ImportFiles, path: PathBuf) -> Uuid {
    let token = Uuid::new_v4();
    files.insert(
        token,
        ImportFile {
            path,
            picked: PICK_SEQUENCE.fetch_add(1, Ordering::Relaxed),
        },
    );
    while files.len() > MAX_PENDING_PREVIEWS {
        let oldest = files
            .iter()
            .min_by_key(|entry| entry.picked)
            .map(|entry| *entry.key());
        match oldest {
            Some(stale) => {
                files.remove(&stale);
            }
            None => break,
        }
    }
    token
}

/// What the dialog shows before an import runs.
///
/// The file itself never crosses the IPC boundary: the JS path this replaces
/// shipped its whole contents as one string and re-parsed it in the renderer.
#[derive(Serialize)]
pub struct PreviewPayload {
    pub file_token: Uuid,
    pub file_name: String,
    pub headers: Vec<String>,
    pub sample: Vec<Vec<String>>,
    pub total_rows_estimate: Option<u64>,
    /// Whether `total_rows_estimate` is the real count, which it is exactly
    /// when the sample reached the end of the file.
    pub total_rows_exact: bool,
}

/// Sample `path`, alongside its size for the row-count extrapolation.
fn preview_file(path: &Path) -> Result<(Sample, u64), IpcError> {
    let delimiter = detect_delimiter(&first_line(path)?);
    let file_len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let file = std::fs::File::open(path).map_err(read_error)?;
    let sample = read_sample(std::io::BufReader::new(file), delimiter, PREVIEW_ROWS)
        .map_err(|e| IpcError::from(format!("Could not read the file: {e}")))?;
    Ok((sample, file_len))
}

/// Pick a CSV file and describe it: headers, a sample of rows, and a rough row
/// count. The path stays here, behind `file_token`, until `import_csv_execute`
/// spends it.
#[tauri::command]
pub async fn import_csv(state: State<'_, AppState>) -> Result<Option<PreviewPayload>, IpcError> {
    let Some(file) = AsyncFileDialog::new()
        .add_filter("CSV", &["csv", "tsv"])
        .add_filter("All Files", &["*"])
        .pick_file()
        .await
    else {
        return Ok(None);
    };

    let path = file.path().to_path_buf();
    let preview_path = path.clone();
    let (sample, file_len) = tokio::task::spawn_blocking(move || preview_file(&preview_path))
        .await
        .map_err(|e| IpcError::from(e.to_string()))??;

    Ok(Some(PreviewPayload {
        file_token: remember_file(&state.import_files, path),
        file_name: file.file_name(),
        total_rows_estimate: estimate_total_rows(
            sample.rows.len() as u64,
            sample.bytes_read,
            file_len,
            sample.exhausted,
        ),
        total_rows_exact: sample.exhausted,
        headers: sample.headers,
        sample: sample.rows,
    }))
}

/// Parse the whole file, sending statements in windows of `window`.
///
/// Runs on a blocking thread with a one-window channel to the executor, so
/// parsing the next window overlaps executing the current one and only those
/// two are ever in memory — the file is never held whole.
fn stream_statements(
    mut reader: csv::Reader<std::fs::File>,
    table: &str,
    database: Option<&str>,
    columns: &[String],
    indices: &[usize],
    quote: char,
    window: usize,
    tx: tokio::sync::mpsc::Sender<Result<Vec<String>, String>>,
) {
    let mut record = csv::StringRecord::new();
    let mut rows: Vec<Vec<Option<String>>> = Vec::with_capacity(ROWS_PER_STATEMENT);
    let mut statements: Vec<String> = Vec::with_capacity(window);

    loop {
        match reader.read_record(&mut record) {
            Ok(true) => {
                rows.push(map_record(&record, indices));
                if rows.len() < ROWS_PER_STATEMENT {
                    continue;
                }
                statements.push(build_insert(table, database, columns, &rows, quote));
                rows.clear();
                if statements.len() == window {
                    let window_statements =
                        std::mem::replace(&mut statements, Vec::with_capacity(window));
                    if tx.blocking_send(Ok(window_statements)).is_err() {
                        return;
                    }
                }
            }
            Ok(false) => break,
            Err(e) => {
                // The rows already sent are still being imported; this stops
                // the file short and is reported as a failed statement so the
                // caller keeps the count of what did land.
                let _ = tx.blocking_send(Err(format!("CSV parse error: {e}")));
                return;
            }
        }
    }

    if !rows.is_empty() {
        statements.push(build_insert(table, database, columns, &rows, quote));
    }
    if !statements.is_empty() {
        let _ = tx.blocking_send(Ok(statements));
    }
}

/// Import the file behind `file_token` into `table`, returning only counts.
///
/// `column_mapping` holds one entry per CSV column: the target column it feeds,
/// or `None` to skip it. Rows go out as multi-row INSERTs run strictly in
/// order, with a `QueryProgress` event per window of statements; nothing but
/// the counts comes back, where the JS path this replaces received a full
/// result envelope per statement.
///
/// The token is spent either way: it is taken out of the map before anything
/// can fail, so no path leaves it behind.
#[tauri::command]
pub async fn import_csv_execute(
    state: State<'_, AppState>,
    file_token: Uuid,
    connection_id: Uuid,
    database: Option<String>,
    table: String,
    column_mapping: Vec<Option<String>>,
    create_table: bool,
    window: Option<usize>,
) -> Result<BatchSummary, IpcError> {
    let (_, file) = state
        .import_files
        .remove(&file_token)
        .ok_or_else(|| IpcError::from("That file is no longer available. Choose it again."))?;

    let (conn, quote) = {
        let active = state
            .connection_manager
            .get(&connection_id)
            .ok_or(IpcError::from("Connection not found"))?;
        (
            Arc::clone(&active.connection),
            identifier_quote(active.dialect.as_ref()),
        )
    };

    let (columns, indices) = split_mapping(&column_mapping);
    if columns.is_empty() {
        return Err(IpcError::from("No CSV column is mapped to a table column."));
    }
    let database = qualifying_database(database.as_deref(), quote).map(str::to_string);

    let reader = tokio::task::spawn_blocking({
        let path = file.path.clone();
        move || open_reader(&path)
    })
    .await
    .map_err(|e| IpcError::from(e.to_string()))??;

    let window = window.unwrap_or(DEFAULT_BATCH_WINDOW).max(1);
    let batch_id = Uuid::new_v4();
    let start = Instant::now();
    let mut outcomes: Vec<StatementOutcome> = Vec::new();

    if create_table {
        let ddl = build_create_table(&table, database.as_deref(), &columns, quote);
        run_statements_windowed(
            conn.as_ref(),
            &state.event_bus,
            batch_id,
            start,
            window,
            &[ddl],
            &mut outcomes,
        )
        .await;
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    let parsing = tokio::task::spawn_blocking({
        let table = table.clone();
        let database = database.clone();
        let columns = columns.clone();
        move || {
            stream_statements(
                reader,
                &table,
                database.as_deref(),
                &columns,
                &indices,
                quote,
                window,
                tx,
            )
        }
    });

    while let Some(batch) = rx.recv().await {
        match batch {
            Ok(statements) => {
                run_statements_windowed(
                    conn.as_ref(),
                    &state.event_bus,
                    batch_id,
                    start,
                    window,
                    &statements,
                    &mut outcomes,
                )
                .await
            }
            Err(message) => outcomes.push(StatementOutcome {
                affected_rows: None,
                error: Some(message),
            }),
        }
    }
    parsing.await.map_err(|e| IpcError::from(e.to_string()))?;

    if create_table {
        state.schema_cache.invalidate_connection(&connection_id);
    }

    Ok(summarize(outcomes))
}

/// The identifier quote character a dialect uses, read back from how it quotes
/// one. `QueryDialect` quotes whole identifiers, while building a statement by
/// hand needs the character itself.
fn identifier_quote(dialect: &dyn QueryDialect) -> char {
    dialect
        .quote_identifier("x")
        .chars()
        .next()
        .unwrap_or('"')
}

#[cfg(test)]
mod tests {
    use super::*;

    const MYSQL: char = '`';
    const ANSI: char = '"';

    fn record(cells: &[&str]) -> csv::StringRecord {
        csv::StringRecord::from(cells.to_vec())
    }

    fn cols(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| n.to_string()).collect()
    }

    fn row(cells: &[Option<&str>]) -> Vec<Option<String>> {
        cells.iter().map(|c| c.map(str::to_string)).collect()
    }

    #[test]
    fn identifiers_are_quoted_with_the_dialects_character() {
        assert_eq!(quote_ident("users", MYSQL), "`users`");
        assert_eq!(quote_ident("users", ANSI), "\"users\"");
    }

    #[test]
    fn an_embedded_identifier_quote_is_doubled() {
        assert_eq!(quote_ident("we`ird", MYSQL), "`we``ird`");
        assert_eq!(quote_ident("we\"ird", ANSI), "\"we\"\"ird\"");
    }

    #[test]
    fn a_value_is_emitted_as_a_quoted_string_and_none_as_a_bare_null() {
        assert_eq!(sql_literal(Some("42"), ANSI), "'42'");
        assert_eq!(sql_literal(None, ANSI), "NULL");
    }

    #[test]
    fn embedded_single_quotes_are_doubled() {
        assert_eq!(sql_literal(Some("it's"), ANSI), "'it''s'");
        assert_eq!(sql_literal(Some("it's"), MYSQL), "'it''s'");
    }

    #[test]
    fn a_trailing_backslash_cannot_escape_the_closing_quote_on_mysql() {
        // MySQL reads `\` as an escape inside string literals, so `'a\'` would
        // swallow the closing quote and let the rest of the file be parsed as
        // SQL. Postgres and SQLite take the backslash literally.
        assert_eq!(sql_literal(Some("a\\"), MYSQL), "'a\\\\'");
        assert_eq!(sql_literal(Some("a\\"), ANSI), "'a\\'");
    }

    #[test]
    fn one_statement_carries_every_row_of_the_batch() {
        let sql = build_insert(
            "people",
            None,
            &cols(&["name", "age"]),
            &[
                row(&[Some("ada"), Some("36")]),
                row(&[Some("bob"), None]),
                row(&[Some("o'hara"), Some("7")]),
            ],
            ANSI,
        );

        assert_eq!(
            sql,
            "INSERT INTO \"people\" (\"name\", \"age\") VALUES\n\
             ('ada', '36'),\n\
             ('bob', NULL),\n\
             ('o''hara', '7')"
        );
    }

    #[test]
    fn mysql_qualifies_the_table_with_the_chosen_database() {
        let sql = build_insert(
            "people",
            Some("shop"),
            &cols(&["name"]),
            &[row(&[Some("ada")])],
            MYSQL,
        );

        assert!(sql.starts_with("INSERT INTO `shop`.`people` (`name`) VALUES"), "{sql}");
    }

    #[test]
    fn a_database_only_qualifies_the_table_where_the_dialect_can_address_it() {
        // A MySQL session can write to any database on the server, which is
        // what the JS path's `USE` statement was reaching for. A Postgres
        // connection cannot, and the dialog's database picker never changes
        // which schema its table list came from.
        assert_eq!(qualifying_database(Some("shop"), MYSQL), Some("shop"));
        assert_eq!(qualifying_database(Some("shop"), ANSI), None);
        assert_eq!(qualifying_database(None, MYSQL), None);
    }

    #[test]
    fn a_qualified_table_quotes_both_halves_separately() {
        assert_eq!(qualified_table("people", Some("shop"), MYSQL), "`shop`.`people`");
        assert_eq!(qualified_table("people", None, MYSQL), "`people`");
    }

    #[test]
    fn mapping_takes_the_named_columns_and_drops_the_skipped_ones() {
        // CSV columns 0 and 2 are mapped; column 1 is skipped entirely.
        let mapped = map_record(&record(&["ada", "ignored", "36"]), &[0, 2]);

        assert_eq!(mapped, row(&[Some("ada"), Some("36")]));
    }

    #[test]
    fn a_record_shorter_than_the_header_is_padded_with_nulls() {
        // `flexible(true)` lets ragged rows through, so a mapping can point
        // past the end of a record.
        let mapped = map_record(&record(&["ada"]), &[0, 1, 2]);

        assert_eq!(mapped, row(&[Some("ada"), None, None]));
    }

    #[test]
    fn empty_and_null_shaped_cells_become_sql_null() {
        // Parity with the JS `escapeValue` this replaces.
        let mapped = map_record(&record(&["", "NULL", "null", "\\N", "0"]), &[0, 1, 2, 3, 4]);

        assert_eq!(mapped, row(&[None, None, None, None, Some("0")]));
    }

    #[test]
    fn mapping_preserves_the_target_order_not_the_csv_order() {
        let mapped = map_record(&record(&["ada", "36"]), &[1, 0]);

        assert_eq!(mapped, row(&[Some("36"), Some("ada")]));
    }

    #[test]
    fn the_header_line_decides_the_delimiter() {
        assert_eq!(detect_delimiter("id,name,email"), b',');
        assert_eq!(detect_delimiter("id\tname\temail"), b'\t');
    }

    #[test]
    fn a_tab_inside_one_field_does_not_make_the_file_tab_separated() {
        // The JS path sniffed the whole file for any tab character, so one
        // tab inside a quoted value made it parse a CSV as a TSV.
        assert_eq!(detect_delimiter("id,\"a\tb\",email"), b',');
    }

    #[test]
    fn a_sample_that_reached_the_end_of_the_file_is_an_exact_count() {
        assert_eq!(estimate_total_rows(12, 300, 300, true), Some(12));
    }

    #[test]
    fn a_truncated_sample_extrapolates_from_its_bytes() {
        assert_eq!(estimate_total_rows(100, 1_000, 10_000, false), Some(1_000));
    }

    #[test]
    fn nothing_is_estimated_without_something_to_extrapolate_from() {
        assert_eq!(estimate_total_rows(0, 0, 10_000, false), None);
        assert_eq!(estimate_total_rows(100, 0, 10_000, false), None);
    }

    #[test]
    fn a_mapping_yields_the_target_columns_and_the_indices_feeding_them() {
        let mapping = vec![
            Some("name".to_string()),
            None,
            Some("age".to_string()),
        ];

        let (columns, indices) = split_mapping(&mapping);

        assert_eq!(columns, cols(&["name", "age"]));
        assert_eq!(indices, vec![0, 2]);
    }

    #[test]
    fn a_created_table_holds_text_because_the_import_types_nothing() {
        assert_eq!(
            build_create_table("people", None, &cols(&["name", "age"]), ANSI),
            "CREATE TABLE IF NOT EXISTS \"people\" (\"name\" TEXT, \"age\" TEXT)"
        );
    }

    #[test]
    fn a_newline_inside_a_quoted_field_stays_one_row() {
        // The hand-rolled JS splitter this replaces cut on every line break,
        // so a quoted newline tore one row into two malformed ones.
        let csv = "id,note\n1,\"first line\nsecond line\"\n2,plain\n";

        let sample = read_sample(csv.as_bytes(), b',', 100).expect("valid csv");

        assert_eq!(sample.headers, cols(&["id", "note"]));
        assert_eq!(sample.rows.len(), 2);
        assert_eq!(sample.rows[0][1], "first line\nsecond line");
        assert!(sample.exhausted);
    }

    #[test]
    fn a_sample_stops_at_its_limit_and_reports_more_to_come() {
        let mut csv = String::from("id\n");
        for i in 0..10 {
            csv.push_str(&format!("{i}\n"));
        }

        let sample = read_sample(csv.as_bytes(), b',', 4).expect("valid csv");

        assert_eq!(sample.rows.len(), 4);
        assert!(!sample.exhausted);
        assert!(sample.bytes_read > 0);
    }

    #[test]
    fn a_ragged_row_is_read_rather_than_aborting_the_file() {
        let sample = read_sample("a,b,c\n1,2\n".as_bytes(), b',', 100).expect("valid csv");

        assert_eq!(sample.rows, vec![cols(&["1", "2"])]);
    }

    #[test]
    fn the_oldest_preview_is_evicted_once_the_map_is_full() {
        let files = ImportFiles::new();
        let tokens: Vec<Uuid> = (0..MAX_PENDING_PREVIEWS + 2)
            .map(|i| remember_file(&files, PathBuf::from(format!("/tmp/{i}.csv"))))
            .collect();

        assert_eq!(files.len(), MAX_PENDING_PREVIEWS);
        assert!(!files.contains_key(&tokens[0]));
        assert!(!files.contains_key(&tokens[1]));
        assert!(files.contains_key(tokens.last().expect("tokens is non-empty")));
    }
}
