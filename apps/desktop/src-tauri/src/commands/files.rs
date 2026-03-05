use rfd::AsyncFileDialog;

#[tauri::command]
pub async fn open_sql_file() -> Result<Option<(String, String)>, String> {
    let file = AsyncFileDialog::new()
        .add_filter("SQL", &["sql"])
        .add_filter("All Files", &["*"])
        .pick_file()
        .await;

    match file {
        Some(f) => {
            let path = f.path().to_path_buf();
            let content =
                tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
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
) -> Result<Option<String>, String> {
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
                .map_err(|e| e.to_string())?;
            let name = f.file_name();
            Ok(Some(name))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn import_csv_file() -> Result<Option<(String, String)>, String> {
    let file = AsyncFileDialog::new()
        .add_filter("CSV", &["csv", "tsv"])
        .add_filter("All Files", &["*"])
        .pick_file()
        .await;

    match file {
        Some(f) => {
            let path = f.path().to_path_buf();
            let content =
                tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?;
            let name = f.file_name();
            Ok(Some((name, content)))
        }
        None => Ok(None),
    }
}
