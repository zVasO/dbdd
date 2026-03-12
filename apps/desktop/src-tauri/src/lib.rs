use std::sync::Arc;

use tauri::{Emitter, Manager};

mod commands;
mod state;

fn build_menu(app: &tauri::App) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error> {
    use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};

    let handle = app.handle();

    // DataForge (App) menu
    let app_menu = Submenu::with_items(
        handle,
        "DataForge",
        true,
        &[
            &PredefinedMenuItem::about(
                handle,
                Some("About DataForge"),
                Some(AboutMetadata::default()),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "preferences",
                "Preferences...",
                true,
                Some("CmdOrCtrl+,"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::hide(handle, Some("Hide DataForge"))?,
            &PredefinedMenuItem::hide_others(handle, Some("Hide Others"))?,
            &PredefinedMenuItem::show_all(handle, Some("Show All"))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::quit(handle, Some("Quit DataForge"))?,
        ],
    )?;

    // File menu
    let file_menu = Submenu::with_items(
        handle,
        "File",
        true,
        &[
            &MenuItem::with_id(
                handle,
                "new_tab",
                "New Query Tab",
                true,
                Some("CmdOrCtrl+N"),
            )?,
            &MenuItem::with_id(
                handle,
                "open_file",
                "Open SQL File...",
                true,
                Some("CmdOrCtrl+O"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "save", "Save", true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                handle,
                "save_as",
                "Save As...",
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "import_csv", "Import CSV...", true, None::<&str>)?,
            &MenuItem::with_id(
                handle,
                "export",
                "Export...",
                true,
                Some("CmdOrCtrl+Shift+E"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "close_tab",
                "Close Tab",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Edit menu
    let edit_menu = Submenu::with_items(
        handle,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(handle, Some("Undo"))?,
            &PredefinedMenuItem::redo(handle, Some("Redo"))?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::cut(handle, Some("Cut"))?,
            &PredefinedMenuItem::copy(handle, Some("Copy"))?,
            &PredefinedMenuItem::paste(handle, Some("Paste"))?,
            &PredefinedMenuItem::select_all(handle, Some("Select All"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "find", "Find", true, Some("CmdOrCtrl+F"))?,
            &MenuItem::with_id(
                handle,
                "insert_snippet",
                "Insert Snippet",
                true,
                Some("CmdOrCtrl+Shift+I"),
            )?,
        ],
    )?;

    // Query menu
    let query_menu = Submenu::with_items(
        handle,
        "Query",
        true,
        &[
            &MenuItem::with_id(
                handle,
                "execute_query",
                "Execute Query",
                true,
                Some("CmdOrCtrl+Return"),
            )?,
            &MenuItem::with_id(handle, "format_sql", "Format SQL", true, None::<&str>)?,
            &MenuItem::with_id(
                handle,
                "toggle_comment",
                "Toggle Comment",
                true,
                Some("CmdOrCtrl+/"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "generate_data",
                "Generate Mock Data",
                true,
                Some("CmdOrCtrl+Shift+G"),
            )?,
            &MenuItem::with_id(
                handle,
                "preview_changes",
                "Preview Changes",
                true,
                Some("CmdOrCtrl+Shift+P"),
            )?,
        ],
    )?;

    // View menu
    let view_menu = Submenu::with_items(
        handle,
        "View",
        true,
        &[
            &MenuItem::with_id(
                handle,
                "toggle_sidebar",
                "Toggle Sidebar",
                true,
                Some("CmdOrCtrl+B"),
            )?,
            &MenuItem::with_id(
                handle,
                "toggle_activity",
                "Toggle Activity Log",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(
                handle,
                "column_filter",
                "Column Filter",
                true,
                Some("CmdOrCtrl+Alt+F"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "command_palette",
                "Command Palette",
                true,
                Some("CmdOrCtrl+K"),
            )?,
            &MenuItem::with_id(
                handle,
                "open_anything",
                "Open Anything",
                true,
                Some("CmdOrCtrl+P"),
            )?,
            &MenuItem::with_id(
                handle,
                "ai_assistant",
                "AI Assistant",
                true,
                Some("CmdOrCtrl+J"),
            )?,
            &PredefinedMenuItem::separator(handle)?,
            &PredefinedMenuItem::fullscreen(handle, Some("Enter Full Screen"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(handle, "toggle_theme", "Toggle Theme", true, None::<&str>)?,
        ],
    )?;

    // Connection menu
    let connection_menu = Submenu::with_items(
        handle,
        "Connection",
        true,
        &[
            &MenuItem::with_id(
                handle,
                "manage_connections",
                "Manage Connections...",
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(handle, "disconnect", "Disconnect", true, None::<&str>)?,
        ],
    )?;

    // Window menu
    let window_menu = Submenu::with_items(
        handle,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(handle, Some("Minimize"))?,
            &PredefinedMenuItem::maximize(handle, Some("Zoom"))?,
            &PredefinedMenuItem::separator(handle)?,
            &MenuItem::with_id(
                handle,
                "bring_all_to_front",
                "Bring All to Front",
                true,
                None::<&str>,
            )?,
        ],
    )?;

    // Help menu
    let help_menu = Submenu::with_items(
        handle,
        "Help",
        true,
        &[&MenuItem::with_id(
            handle,
            "help",
            "DataForge Help",
            true,
            None::<&str>,
        )?],
    )?;

    Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &query_menu,
            &view_menu,
            &connection_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "dataforge=info".into()),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

            let config_store =
                Arc::new(dataforge_config::store::ConfigStore::new(&app_data_dir)?);
            let driver_registry =
                Arc::new(dataforge_engine::driver_registry::DriverRegistry::new());
            let event_bus =
                Arc::new(dataforge_engine::event_bus::EventBus::new(app.handle().clone()));
            let connection_manager = Arc::new(
                dataforge_engine::connection_manager::ConnectionManager::new(
                    driver_registry.clone(),
                ),
            );
            let schema_cache = Arc::new(dataforge_engine::schema_cache::SchemaCache::new());

            app.manage(state::AppState {
                connection_manager,
                config_store,
                schema_cache,
                event_bus,
                driver_registry,
            });

            let menu = build_menu(app)?;
            app.set_menu(menu)?;

            app.on_menu_event(move |app, event| {
                if let Err(e) = app.emit("menu-event", event.id().0.as_str()) {
                    tracing::error!(menu_id = %event.id().0, error = %e, "Failed to emit menu event");
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::connection::connect,
            commands::connection::disconnect,
            commands::connection::test_connection,
            commands::connection::list_saved_connections,
            commands::connection::delete_saved_connection,
            commands::connection::ping_connection,
            commands::query::execute_query,
            commands::query::execute_query_columnar,
            commands::query::cancel_query,
            commands::query::get_query_history,
            commands::query::execute_batch,
            commands::query::execute_query_stream,
            commands::schema::list_databases,
            commands::schema::list_schemas,
            commands::schema::list_tables,
            commands::schema::get_table_structure,
            commands::files::open_sql_file,
            commands::files::save_sql_file,
            commands::files::import_csv_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
