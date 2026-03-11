use std::sync::Arc;

use tauri::Manager;

mod commands;
mod state;

pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "dataforge=info".into()),
        )
        .init();

    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data dir");

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
