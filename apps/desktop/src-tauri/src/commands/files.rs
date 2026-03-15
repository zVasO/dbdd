use dataforge_core::error::IpcError;
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

#[tauri::command]
pub async fn save_sql_file(
    content: String,
    suggested_name: Option<String>,
) -> Result<Option<String>, IpcError> {
    let mut dialog = AsyncFileDialog::new()
        .add_filter("SQL", &["sql"])
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
