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
        let _ = dashboard.set_size(tauri::Size::Logical(tauri::LogicalSize {
            width: 1000.0,
            height: 720.0,
        }));
    } else {
        if let Ok(w) = tauri::WebviewWindowBuilder::new(
            &app,
            "dashboard",
            tauri::WebviewUrl::App("index.html?window=dashboard".into()),
        )
        .title("Companion Dashboard")
        .inner_size(1000.0, 720.0)
        .min_inner_size(650.0, 450.0)
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
fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    Ok(())
}

#[tauri::command]
fn draw_on_screen(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    payload: serde_json::Value,
) -> Result<(), String> {
    let overlay = if let Some(w) = app.get_webview_window("overlay") {
        w
    } else {
        tauri::WebviewWindowBuilder::new(
            &app,
            "overlay",
            tauri::WebviewUrl::App("index.html?window=overlay".into()),
        )
        .title("Screen Annotation Overlay")
        .transparent(true)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(false)
        .focusable(false)
        .fullscreen(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?
    };

    // Store the payload so the overlay can fetch it on mount, even if the WebView has not
    // finished loading yet (otherwise the very first draw-on-screen event is silently dropped).
    if let Ok(mut pending) = state.pending_annotation.lock() {
        *pending = Some(payload.clone());
    }

    // Cover the screen. Native fullscreen on macOS switches to a new Space, which breaks a
    // click-through annotation overlay, so use simple (borderless) fullscreen there instead.
    #[cfg(target_os = "macos")]
    let _ = overlay.set_simple_fullscreen(true);
    #[cfg(not(target_os = "macos"))]
    let _ = overlay.set_fullscreen(true);
    let _ = overlay.show();
    let _ = overlay.set_always_on_top(true);
    let _ = app.emit("draw-on-screen", payload);
    // Delay set_ignore_cursor_events so the Wayland surface is fully committed,
    // then refocus the previously-active window via hyprctl.
    let overlay_clone = overlay.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let _ = overlay_clone.set_ignore_cursor_events(true);
        let _ = std::process::Command::new("hyprctl")
            .args(["dispatch", "focuscurrentorlast"])
            .output();
    });
    Ok(())
}

/// Called once by the overlay window on mount: returns and clears any draw payload that was
/// emitted before the overlay finished loading. Guarantees the first annotation is rendered.
#[tauri::command]
fn take_pending_annotation(state: tauri::State<'_, AppState>) -> Result<Option<serde_json::Value>, String> {
    let mut pending = state
        .pending_annotation
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(pending.take())
}

#[tauri::command]
fn clear_screen_annotations(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("clear-screen-annotations", ());
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
    Ok(())
}

#[tauri::command]
fn mouse_click(
    state: tauri::State<'_, AppState>,
    x: f64,
    y: f64,
    button: Option<String>,
    click_type: Option<String>,
) -> Result<(), String> {
    let (px, py) = hands::vision::normalized_to_logical(x, y)?;
    state.os_controller.mouse_click(
        px,
        py,
        button.as_deref().unwrap_or("left"),
        click_type.as_deref().unwrap_or("single"),
    )
}

#[tauri::command]
fn mouse_scroll(
    state: tauri::State<'_, AppState>,
    x: f64,
    y: f64,
    direction: Option<String>,
    amount: Option<i32>,
) -> Result<(), String> {
    let (px, py) = hands::vision::normalized_to_logical(x, y)?;
    state.os_controller.mouse_scroll(
        px,
        py,
        direction.as_deref().unwrap_or("down"),
        amount.unwrap_or(3),
    )
}

#[tauri::command]
fn type_text(
    state: tauri::State<'_, AppState>,
    text: String,
    submit: Option<bool>,
) -> Result<(), String> {
    state.os_controller.type_text(&text, submit.unwrap_or(false))
}

#[tauri::command]
fn press_hotkey(state: tauri::State<'_, AppState>, keys: Vec<String>) -> Result<(), String> {
    state.os_controller.press_hotkey(&keys)
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
fn set_mascot_scale(app: tauri::AppHandle, scale: f64) -> Result<(), String> {
    let clamped_scale = scale.clamp(0.5, 3.0);
    let base_w = 380.0;
    let base_h = 520.0;
    let width = (base_w * clamped_scale).round();
    let height = (base_h * clamped_scale).round();

    if let Some(mascot) = app.get_webview_window("mascot") {
        let _ = mascot.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
    }

    #[cfg(target_os = "linux")]
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() {
        let _ = std::process::Command::new("hyprctl")
            .args([
                "eval",
                &format!(
                    "return hl.dispatch(hl.dsp.window.resize({{ x = {}, y = {}, \"exact\" }}))",
                    width as i32, height as i32
                ),
            ])
            .output();
    }

    let _ = app.emit("mascot-scale-changed", clamped_scale);
    Ok(())
}

#[cfg(target_os = "linux")]
fn ensure_hyprland_rules() {
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_err() {
        return;
    }
    let home = match std::env::var("HOME") {
        Ok(h) => std::path::PathBuf::from(h),
        Err(_) => return,
    };

    let custom_rules_path = home.join(".config/hypr/custom/rules.lua");
    let mut should_reload = false;

    if custom_rules_path.parent().map(|p| p.exists()).unwrap_or(false) {
        let existing = std::fs::read_to_string(&custom_rules_path).unwrap_or_default();
        let mut companion_rules = String::new();
        if !existing.contains("Companion Mascot") {
            companion_rules.push_str(r#"
-- Companion Window Rules (Wayland / Hyprland)
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Mascot)$" }, float = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Mascot)$" }, size = { 380, 520 }})
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Mascot)$" }, pin = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Mascot)$" }, no_shadow = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Mascot)$" }, no_blur = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Mascot)$" }, border_size = 0})

hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Dashboard)$" }, float = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Dashboard)$" }, size = { 1000, 720 }})
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Dashboard)$" }, center = true})
"#);
        } else if !existing.contains("border_size = 0") {
            // Existing mascot block predates the border-removal rule; append just the missing one.
            companion_rules.push_str(r#"
hl.window_rule({match = {class = "^(companion)$", title = "^(Companion Mascot)$" }, border_size = 0})
"#);
        }
        if !existing.contains("Screen Annotation Overlay") {
            companion_rules.push_str(r#"
-- Screen Annotation Overlay Rules (Transparent, click-through, covering whole screen)
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, float = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, pin = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, no_shadow = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, no_blur = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, no_focus = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, no_initial_focus = true})
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, move = {0, 0} })
hl.window_rule({match = {class = "^(companion)$", title = "^(Screen Annotation Overlay)$" }, size = {"(monitor_w)", "(monitor_h)"} })
"#);
        }
        if !companion_rules.is_empty() {
            let new_content = format!("{}{}", existing, companion_rules);
            if std::fs::write(&custom_rules_path, new_content).is_ok() {
                should_reload = true;
            }
        }
    } else {
        let hyprland_conf = home.join(".config/hypr/hyprland.conf");
        if hyprland_conf.exists() {
            let existing = std::fs::read_to_string(&hyprland_conf).unwrap_or_default();
            let mut companion_rules = String::new();
            if !existing.contains("Companion Mascot") {
                companion_rules.push_str(r#"
# Companion Window Rules (Wayland / Hyprland)
windowrulev2 = float, class:^(companion)$, title:^(Companion Mascot)$
windowrulev2 = size 380 520, class:^(companion)$, title:^(Companion Mascot)$
windowrulev2 = pin, class:^(companion)$, title:^(Companion Mascot)$
windowrulev2 = noborder, class:^(companion)$, title:^(Companion Mascot)$
windowrulev2 = noshadow, class:^(companion)$, title:^(Companion Mascot)$
windowrulev2 = noblur, class:^(companion)$, title:^(Companion Mascot)$
windowrulev2 = float, class:^(companion)$, title:^(Companion Dashboard)$
windowrulev2 = size 1000 720, class:^(companion)$, title:^(Companion Dashboard)$
windowrulev2 = center, class:^(companion)$, title:^(Companion Dashboard)$
"#);
            } else {
                // Existing mascot block predates the no-border/no-shadow/no-blur rules; append any that are missing.
                if !existing.contains("noborder, class:^(companion)$, title:^(Companion Mascot)") {
                    companion_rules.push_str(r#"windowrulev2 = noborder, class:^(companion)$, title:^(Companion Mascot)$
"#);
                }
                if !existing.contains("noshadow, class:^(companion)$, title:^(Companion Mascot)") {
                    companion_rules.push_str(r#"windowrulev2 = noshadow, class:^(companion)$, title:^(Companion Mascot)$
"#);
                }
                if !existing.contains("noblur, class:^(companion)$, title:^(Companion Mascot)") {
                    companion_rules.push_str(r#"windowrulev2 = noblur, class:^(companion)$, title:^(Companion Mascot)$
"#);
                }
            }
            if !existing.contains("Screen Annotation Overlay") {
                companion_rules.push_str(r#"
windowrulev2 = float, class:^(companion)$, title:^(Screen Annotation Overlay)$
windowrulev2 = pin, class:^(companion)$, title:^(Screen Annotation Overlay)$
windowrulev2 = noborder, class:^(companion)$, title:^(Screen Annotation Overlay)$
windowrulev2 = noshadow, class:^(companion)$, title:^(Screen Annotation Overlay)$
windowrulev2 = noblur, class:^(companion)$, title:^(Screen Annotation Overlay)$
windowrulev2 = nofocus, class:^(companion)$, title:^(Screen Annotation Overlay)$
windowrulev2 = move 0 0, class:^(companion)$, title:^(Screen Annotation Overlay)$
windowrulev2 = size 100% 100%, class:^(companion)$, title:^(Screen Annotation Overlay)$
"#);
            }
            if !companion_rules.is_empty() {
                let new_content = format!("{}\n{}", existing, companion_rules);
                if std::fs::write(&hyprland_conf, new_content).is_ok() {
                    should_reload = true;
                }
            }
        }
    }

    if should_reload {
        let _ = std::process::Command::new("hyprctl").arg("reload").output();
    }
}

#[tauri::command]
fn open_devtools(_app: tauri::AppHandle) {
    #[cfg(debug_assertions)]
    if let Some(mascot) = _app.get_webview_window("mascot") {
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
                    "emergency_stop" => {
                        // Kill-switch: force the backend into 'safe' mode so all input
                        // emulation and shell execution is rejected immediately.
                        if let Some(state) = app.try_state::<AppState>() {
                            state
                                .os_controller
                                .set_permission_mode(crate::hands::PermissionMode::Safe);
                        }
                        let _ = app.emit("permission-mode-changed", "safe");
                        let _ = app.emit("emergency-stop", ());
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
                pending_annotation: Arc::new(Mutex::new(None)),
            });

            #[cfg(target_os = "linux")]
            ensure_hyprland_rules();

            if let Some(mascot) = app.get_webview_window("mascot") {
                let _ = mascot.set_size(tauri::Size::Logical(tauri::LogicalSize {
                    width: 380.0,
                    height: 520.0,
                }));
            }

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
                ("emergency_stop", "Super+Shift+X"),
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
            let husk_handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(err) = husk::start_husk_listener(husk_handle).await {
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
            ipc::get_permission_mode,
            ipc::set_permission_mode,
            hands::vision::capture_screen_snapshot,
            hands::vision::capture_screen_geometry,
            show_dashboard,
            hide_mascot,
            toggle_mascot,
            set_mascot_scale,
            quit_app,
            update_global_shortcuts,
            open_devtools,
            hide_overlay,
            draw_on_screen,
            take_pending_annotation,
            clear_screen_annotations,
            mouse_click,
            mouse_scroll,
            type_text,
            press_hotkey,
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
