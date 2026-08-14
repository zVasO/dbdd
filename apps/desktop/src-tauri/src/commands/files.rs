use purrql_core::error::IpcError;
use rfd::AsyncFileDialog;

/// Maximum file size allowed for in-memory reads (100 MB).
const MAX_FILE_SIZE_BYTES: u64 = 100 * 1024 * 1024;

async fn check_file_size(path: &std::path::Path) -> Result<(), IpcError> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|e| IpcError::from(e.to_string()))?;
    if metadata.len() > MAX_FILE_SIZE_BYTES {
        return Err(IpcError::from(format!(
            "File is too large ({} MB). Maximum allowed is {} MB.",
            metadata.len() / 1_048_576,
            MAX_FILE_SIZE_BYTES / 1_048_576,
        )));
    }
    Ok(())
}

#[tauri::command]
pub async fn open_sql_file() -> Result<Option<(String, String)>, IpcError> {
    let file = AsyncFileDialog::new()
        .add_filter("SQL", &["sql"])
        .add_filter("All Files", &["*"])
        .pick_file()
        .await;

    match file {
        Some(f) => {
            let path = f.path().to_path_buf();
            check_file_size(&path).await?;
            let content =
                tokio::fs::read_to_string(&path).await.map_err(|e| IpcError::from(e.to_string()))?;
            let name = f.file_name();
            Ok(Some((name, content)))
        }
        None => Ok(None),
    }
}

/// Save-dialog filter for a requested file name. The command also saves CSV and
/// JSON exports, so a hardcoded `*.sql` filter would hide the file being written.
fn save_filter_for(suggested_name: Option<&str>) -> (&'static str, &'static [&'static str]) {
    let ext = suggested_name
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, ext)| ext.to_ascii_lowercase());
    match ext.as_deref() {
        Some("csv") => ("CSV", &["csv"]),
        Some("json") => ("JSON", &["json"]),
        _ => ("SQL", &["sql"]),
    }
}

#[tauri::command]
pub async fn save_sql_file(
    content: String,
    suggested_name: Option<String>,
) -> Result<Option<String>, IpcError> {
    let (filter_label, filter_exts) = save_filter_for(suggested_name.as_deref());
    let mut dialog = AsyncFileDialog::new()
        .add_filter(filter_label, filter_exts)
        .add_filter("All Files", &["*"]);

    if let Some(name) = &suggested_name {
        dialog = dialog.set_file_name(name);
    }

    let file = dialog.save_file().await;

    match file {
        Some(f) => {
            let path = f.path().to_path_buf();
            tokio::fs::write(&path, &content)
                .await
                .map_err(|e| IpcError::from(e.to_string()))?;
            let name = f.file_name();
            Ok(Some(name))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn import_csv_file() -> Result<Option<(String, String)>, IpcError> {
    let file = AsyncFileDialog::new()
        .add_filter("CSV", &["csv", "tsv"])
        .add_filter("All Files", &["*"])
        .pick_file()
        .await;

    match file {
        Some(f) => {
            let path = f.path().to_path_buf();
            check_file_size(&path).await?;
            let content =
                tokio::fs::read_to_string(&path).await.map_err(|e| IpcError::from(e.to_string()))?;
            let name = f.file_name();
            Ok(Some((name, content)))
        }
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::save_filter_for;

    #[test]
    fn filter_follows_the_requested_extension() {
        assert_eq!(save_filter_for(Some("users.csv")), ("CSV", &["csv"][..]));
        assert_eq!(save_filter_for(Some("users.JSON")), ("JSON", &["json"][..]));
        assert_eq!(save_filter_for(Some("users.sql")), ("SQL", &["sql"][..]));
    }

    #[test]
    fn unknown_and_missing_extensions_fall_back_to_sql() {
        assert_eq!(save_filter_for(Some("dump.bak")), ("SQL", &["sql"][..]));
        assert_eq!(save_filter_for(Some("dump")), ("SQL", &["sql"][..]));
        assert_eq!(save_filter_for(None), ("SQL", &["sql"][..]));
    }

    #[test]
    fn only_the_last_extension_counts() {
        assert_eq!(save_filter_for(Some("orders.csv.json")), ("JSON", &["json"][..]));
    }
}
