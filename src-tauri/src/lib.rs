// GNU General Public License v3.0
// Production-ready AI Desktop Companion Tauri Core

pub mod brain;
pub mod hands;
pub mod husk;
pub mod ipc;

use brain::MemoryStore;
use hands::create_os_controller;
use hands::indexer::AppIndexer;
use ipc::AppState;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{
    Builder as ShortcutBuilder, GlobalShortcutExt, Shortcut, ShortcutState,
};

#[derive(Clone)]
pub struct ShortcutStateMap(pub Arc<Mutex<HashMap<Shortcut, String>>>);

#[tauri::command]
fn show_dashboard(app: tauri::AppHandle) {
    if let Some(dashboard) = app.get_webview_window("dashboard") {
        let _ = dashboard.show();
        let _ = dashboard.unminimize();
        let _ = dashboard.set_focus();
    } else {
        if let Ok(w) = tauri::WebviewWindowBuilder::new(
            &app,
            "dashboard",
            tauri::WebviewUrl::App("index.html?window=dashboard".into()),
        )
        .title("Companion Dashboard")
        .inner_size(1000.0, 720.0)
        .resizable(true)
        .decorations(true)
        .build()
        {
            let w_clone = w.clone();
            w.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = w_clone.hide();
                }
            });
            let _ = w.show();
            let _ = w.set_focus();
        }
    }
}

#[tauri::command]
fn hide_mascot(app: tauri::AppHandle) {
    if let Some(mascot) = app.get_webview_window("mascot") {
        let _ = mascot.hide();
    }
}

#[tauri::command]
fn toggle_mascot(app: tauri::AppHandle) {
    if let Some(mascot) = app.get_webview_window("mascot") {
        if mascot.is_visible().unwrap_or(true) {
            let _ = mascot.hide();
        } else {
            let _ = mascot.show();
            let _ = mascot.unminimize();
            let _ = mascot.set_focus();
        }
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn update_global_shortcuts(
    app: tauri::AppHandle,
    shortcuts: HashMap<String, String>,
) -> Result<(), String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();

    if let Some(state_map) = app.try_state::<ShortcutStateMap>() {
        let mut map = state_map.0.lock().map_err(|e| e.to_string())?;
        map.clear();
        for (action, key_str) in shortcuts {
            let trimmed = key_str.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(sc) = trimmed.parse::<Shortcut>() {
                if gs.register(sc.clone()).is_ok() {
                    map.insert(sc, action);
                }
            }
        }
    }
    Ok(())
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
    let shortcut_map = Arc::new(Mutex::new(HashMap::<Shortcut, String>::new()));
    let map_clone = shortcut_map.clone();

    let shortcut_plugin = ShortcutBuilder::new().with_handler(move |app, shortcut, event| {
        if event.state() == ShortcutState::Pressed {
            let action = {
                let lock = map_clone.lock().ok();
                lock.and_then(|m| m.get(shortcut).cloned())
            };
            if let Some(act) = action {
                match act.as_str() {
                    "toggle_mascot" => {
                        toggle_mascot(app.clone());
                    }
                    "open_settings" => {
                        show_dashboard(app.clone());
                    }
                    "toggle_history" => {
                        let _ = app.emit("toggle-history", ());
                    }
                    "quit_app" => {
                        app.exit(0);
                    }
                    _ => {}
                }
            }
        }
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(shortcut_plugin.build())
        .manage(ShortcutStateMap(shortcut_map.clone()))
        .setup(move |app| {
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

            // 4. Hook close request on dashboard window so it hides instead of destroying
            if let Some(dashboard) = app.get_webview_window("dashboard") {
                let d_clone = dashboard.clone();
                dashboard.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = d_clone.hide();
                    }
                });
            }

            // 5. Build System Tray Menu & Tray Icon
            let toggle_item = MenuItem::with_id(
                &app_handle,
                "toggle_mascot",
                "Показать / Скрыть компаньона",
                true,
                None::<&str>,
            )?;
            let settings_item =
                MenuItem::with_id(&app_handle, "settings", "Настройки", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(&app_handle, "quit", "Выход", true, None::<&str>)?;
            let tray_menu =
                Menu::with_items(&app_handle, &[&toggle_item, &settings_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("main-tray")
                .tooltip("AI Desktop Companion")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "toggle_mascot" => {
                        toggle_mascot(app.clone());
                    }
                    "settings" => {
                        show_dashboard(app.clone());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        toggle_mascot(app.clone());
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            // 6. Register initial default global shortcuts
            let default_shortcuts = [
                ("toggle_mascot", "Ctrl+Shift+H"),
                ("open_settings", "Ctrl+Shift+S"),
                ("toggle_history", "Ctrl+Shift+L"),
                ("quit_app", "Ctrl+Shift+Q"),
            ];
            let gs = app_handle.global_shortcut();
            if let Ok(mut initial_map) = shortcut_map.lock() {
                for (act, key) in default_shortcuts {
                    if let Ok(sc) = key.parse::<Shortcut>() {
                        if gs.register(sc.clone()).is_ok() {
                            initial_map.insert(sc, act.to_string());
                        }
                    }
                }
            }

            // 7. Lazy First-Run App Indexing (Non-blocking background thread)
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

            // 8. Spawn Async Husk Mode Socket Listener
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
            hide_mascot,
            toggle_mascot,
            quit_app,
            update_global_shortcuts,
            open_devtools,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shortcut_parsing() {
        let valid_keys = [
            "Ctrl+Shift+H",
            "Ctrl+Shift+S",
            "Ctrl+Shift+L",
            "Ctrl+Shift+Q",
            "Alt+H",
            "CommandOrControl+Shift+H",
        ];
        for k in valid_keys {
            assert!(
                k.parse::<Shortcut>().is_ok(),
                "Failed to parse valid shortcut: {}",
                k
            );
        }

        let invalid_keys = ["", "InvalidKeyCombo123", "   "];
        for k in invalid_keys {
            assert!(
                k.parse::<Shortcut>().is_err(),
                "Expected parse error for invalid shortcut: {}",
                k
            );
        }
    }

    #[test]
    fn test_shortcut_state_map() {
        let map = Arc::new(Mutex::new(HashMap::<Shortcut, String>::new()));
        let sc: Shortcut = "Ctrl+Shift+H".parse().unwrap();
        {
            let mut lock = map.lock().unwrap();
            lock.insert(sc.clone(), "toggle_mascot".to_string());
        }

        let lock = map.lock().unwrap();
        assert_eq!(lock.get(&sc).map(|s| s.as_str()), Some("toggle_mascot"));
    }
}
