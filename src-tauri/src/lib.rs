// GNU General Public License v3.0
// Production-ready AI Desktop Companion Tauri Core

pub mod brain;
pub mod hands;
pub mod husk;
pub mod ipc;

use brain::MemoryStore;
use hands::indexer::AppIndexer;
use hands::create_os_controller;
use ipc::AppState;
use std::sync::Arc;
use tauri::Manager;

#[tauri::command]
fn show_dashboard(app: tauri::AppHandle) {
    if let Some(dashboard) = app.get_webview_window("dashboard") {
        let _ = dashboard.show();
        let _ = dashboard.set_focus();
    }
}

#[tauri::command]
fn open_devtools(app: tauri::AppHandle) {
    if let Some(mascot) = app.get_webview_window("mascot") {
        #[cfg(debug_assertions)]
        mascot.open_devtools();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // 1. Initialize SQLite Long-Term Memory Store
            let db_path = if let Ok(data_dir) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&data_dir);
                data_dir.join("companion_memory.db")
            } else {
                let mut p = std::env::temp_dir();
                p.push("companion_memory.db");
                p
            };
            println!("[MemoryStore] SQLite path: {:?}", db_path);
            let memory_store = Arc::new(
                MemoryStore::new(db_path.to_str().unwrap_or("companion_memory.db"))
                    .expect("Failed to initialize SQLite memory database"),
            );

            // 2. Initialize OS Controller using native platform factory
            let os_controller = create_os_controller(memory_store.clone());

            // 3. Register Global App State
            app.manage(AppState {
                os_controller,
                memory_store: memory_store.clone(),
            });

            // 4. Lazy First-Run App Indexing (Non-blocking background thread)
            let store_indexer = memory_store.clone();
            tauri::async_runtime::spawn(async move {
                if store_indexer.count_installed_apps().unwrap_or(0) == 0 {
                    println!("[AppIndexer] First-run detected: performing background XDG desktop application indexing...");
                    let apps = AppIndexer::scan();
                    let count = apps.len();
                    if let Ok(inserted) = store_indexer.upsert_installed_apps(&apps) {
                        println!("[AppIndexer] Background scan complete: indexed {} of {} applications into SQLite.", inserted, count);
                    }
                }
            });

            // 5. Spawn Async Husk Mode Socket Listener
            tauri::async_runtime::spawn(async move {
                if let Err(err) = husk::start_husk_listener(app_handle).await {
                    eprintln!("[HuskMode] Fatal error in socket listener: {}", err);
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::get_system_context,
            ipc::refresh_system_index,
            ipc::get_active_window,
            ipc::open_url,
            ipc::launch_app,
            ipc::launch_application,
            ipc::execute_sandboxed_shell,
            ipc::save_memory_entry,
            ipc::search_memory,
            ipc::get_all_memories,
            ipc::delete_memory,
            ipc::get_relevant_memory_context,
            ipc::set_window_clickthrough,
            ipc::capture_screen_snapshot,
            show_dashboard,
            open_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
