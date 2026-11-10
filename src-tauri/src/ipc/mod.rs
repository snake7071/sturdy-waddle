// GNU General Public License v3.0
// IPC Command Handlers bridging Frontend and Rust Core

use crate::brain::{MemoryItem, MemoryStore};
use crate::hands::indexer::AppIndexer;
use crate::hands::system_info::{get_system_profile, SystemProfile};
use crate::hands::{ExecutionResult, OsController, WindowGeometry};
use base64::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{State, Window};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommandApprovalRequest {
    pub command: String,
    pub explanation: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScreenCaptureResult {
    pub success: bool,
    pub base64_image: Option<String>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemContextResponse {
    pub profile: SystemProfile,
    pub total_apps: usize,
    pub last_updated: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndexSummary {
    pub total_apps: usize,
    pub last_updated: String,
    pub os: String,
}

pub struct AppState {
    pub os_controller: Arc<dyn OsController>,
    pub memory_store: Arc<MemoryStore>,
}

#[tauri::command]
pub async fn get_system_context(state: State<'_, AppState>) -> Result<SystemContextResponse, String> {
    let profile = get_system_profile();
    let total_apps = state.memory_store.count_installed_apps().unwrap_or(0);
    let last_updated = state.memory_store.get_last_index_time().unwrap_or(None);

    Ok(SystemContextResponse {
        profile,
        total_apps,
        last_updated,
    })
}

#[tauri::command]
pub async fn refresh_system_index(state: State<'_, AppState>) -> Result<IndexSummary, String> {
    // 1. Scan applications on host
    let scanned_apps = AppIndexer::scan();

    // 2. Upsert into SQLite
    let total_apps = state
        .memory_store
        .upsert_installed_apps(&scanned_apps)
        .map_err(|e| format!("Failed to index applications: {}", e))?;

    let last_updated = state
        .memory_store
        .get_last_index_time()
        .unwrap_or(None)
        .unwrap_or_else(|| "Just now".to_string());

    let profile = get_system_profile();

    Ok(IndexSummary {
        total_apps,
        last_updated,
        os: format!("{} {}", profile.os_name, profile.os_version),
    })
}

#[tauri::command]
pub async fn get_active_window(state: State<'_, AppState>) -> Result<WindowGeometry, String> {
    state.os_controller.get_active_window().await
}

#[tauri::command]
pub async fn open_url(url: String, state: State<'_, AppState>) -> Result<(), String> {
    state.os_controller.open_url(&url).await
}

#[tauri::command]
pub async fn launch_app(
    app_name: Option<String>,
    args: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let name = app_name.unwrap_or_default();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Не указано имя приложения для запуска".into());
    }
    state.os_controller.launch_app(trimmed, &args.unwrap_or_default()).await
}

#[tauri::command]
pub async fn launch_application(
    app_name: Option<String>,
    args: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let name = app_name.unwrap_or_default();
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Не указано имя приложения для запуска".into());
    }
    state.os_controller.launch_app(trimmed, &args.unwrap_or_default()).await
}

#[tauri::command]
pub async fn execute_sandboxed_shell(
    command: String,
    cwd: Option<String>,
    state: State<'_, AppState>,
) -> Result<ExecutionResult, String> {
    state.os_controller.execute_shell(&command, cwd.as_deref()).await
}

#[tauri::command]
pub async fn save_memory_entry(
    item: MemoryItem,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.memory_store.save(item)
}

#[tauri::command]
pub async fn search_memory(
    query: String,
    state: State<'_, AppState>,
) -> Result<Vec<MemoryItem>, String> {
    state.memory_store.search(&query)
}

#[tauri::command]
pub async fn set_window_clickthrough(
    window: Window,
    ignore_cursor: bool,
) -> Result<(), String> {
    window
        .set_ignore_cursor_events(ignore_cursor)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn capture_screen_snapshot(
    _reason: String,
) -> Result<ScreenCaptureResult, String> {
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg("if which grim >/dev/null 2>&1; then grim -t jpeg -q 60 -; elif which maim >/dev/null 2>&1; then maim -f jpg -m 6 -; elif which import >/dev/null 2>&1; then import -window root -quality 60 jpeg:-; else echo 'NO_CAPTURE_TOOL'; fi")
        .output();

    match output {
        Ok(out) => {
            if out.status.success() && !out.stdout.is_empty() {
                if out.stdout.starts_with(b"NO_CAPTURE_TOOL") {
                    return Ok(ScreenCaptureResult {
                        success: false,
                        base64_image: None,
                        error: Some("No screenshot utility (grim/maim/import) found on host.".into()),
                    });
                }
                let encoded = BASE64_STANDARD.encode(&out.stdout);
                let b64 = format!("data:image/jpeg;base64,{}", encoded);
                Ok(ScreenCaptureResult {
                    success: true,
                    base64_image: Some(b64),
                    error: None,
                })
            } else {
                Ok(ScreenCaptureResult {
                    success: false,
                    base64_image: None,
                    error: Some("Screenshot command exited with error".into()),
                })
            }
        }
        Err(e) => Ok(ScreenCaptureResult {
            success: false,
            base64_image: None,
            error: Some(format!("Failed to run capture tool: {}", e)),
        }),
    }
}
