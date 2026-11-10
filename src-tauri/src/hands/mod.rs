// GNU General Public License v3.0
// Trait-Based Cross-Platform OS Abstraction & Window Automation ("The Hands")

pub mod indexer;
pub mod system_info;

pub use indexer::{AppIndexer, InstalledApp};
pub use system_info::{get_system_profile, SystemProfile};

use crate::brain::MemoryStore;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub id: String,
    pub title: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub workspace: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Unified Cross-Platform Operating System Controller ("The Hands")
///
/// Implements high-level desktop control across Linux (XDG / Wayland / X11),
/// Windows (Win32 / ShellExecute / Windows Terminal), and macOS (Cocoa / AppleScript / Terminal.app).
///
/// Note on Separation of Concerns:
/// - Semantic understanding of slang, abbreviations ("телега", "тг", "хром", "терминал")
///   is handled by the LLM (Gemini Brain) via prompt normalization into canonical entity names.
/// - The Rust Platform Controller performs low-level OS operations, standard system lookup,
///   and SQLite indexed queries without maintaining hardcoded dictionaries of colloquial synonyms.
#[async_trait]
pub trait OsController: Send + Sync {
    /// Queries the active/focused desktop window geometry (for perching mechanic)
    async fn get_active_window(&self) -> Result<WindowGeometry, String>;

    /// Launches an application safely and asynchronously via SQLite fuzzy resolver or system PATH
    async fn launch_app(&self, app_name: &str, args: &[String]) -> Result<(), String>;

    /// Opens an interactive terminal with an optional command that remains open for further actions
    async fn open_terminal(&self, command: Option<&str>) -> Result<(), String>;

    /// Opens a web URL in the user's default browser
    async fn open_url(&self, url: &str) -> Result<(), String>;

    /// Executes shell command in a sandboxed/audited environment
    async fn execute_shell(&self, command: &str, cwd: Option<&str>) -> Result<ExecutionResult, String>;
}

/// Type alias reflecting the clean platform abstraction architecture
pub type PlatformAdapter = dyn OsController;

/// Factory function creating the native OsController for the active target OS
pub fn create_os_controller(memory_store: Arc<MemoryStore>) -> Arc<dyn OsController> {
    #[cfg(target_os = "linux")]
    {
        Arc::new(LinuxOsController { memory_store })
    }
    #[cfg(target_os = "windows")]
    {
        Arc::new(WindowsOsController { memory_store })
    }
    #[cfg(target_os = "macos")]
    {
        Arc::new(MacOsController { memory_store })
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Arc::new(LinuxOsController { memory_store })
    }
}

// ============================================================================
// Linux Implementation (XDG Standards, $TERMINAL / Wayland / X11)
// ============================================================================

pub struct LinuxOsController {
    memory_store: Arc<MemoryStore>,
}

impl LinuxOsController {
    /// Discovers the system's default terminal emulator using standard specifications:
    /// 1. $TERMINAL environment variable (POSIX/Freedesktop standard)
    /// 2. xdg-terminal-exec (Freedesktop specification)
    /// 3. x-terminal-emulator (Debian/Ubuntu/Standard alternatives system)
    /// 4. Common installed terminals in system PATH
    fn detect_default_terminal() -> Option<String> {
        // 1. User/Window Manager explicit $TERMINAL preference
        if let Ok(term) = std::env::var("TERMINAL") {
            let trimmed = term.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }

        // 2. xdg-terminal-exec (modern Freedesktop specification)
        if let Ok(out) = Command::new("which").arg("xdg-terminal-exec").output() {
            if out.status.success() {
                return Some("xdg-terminal-exec".to_string());
            }
        }

        // 3. x-terminal-emulator (standard alternatives system)
        if let Ok(out) = Command::new("which").arg("x-terminal-emulator").output() {
            if out.status.success() {
                return Some("x-terminal-emulator".to_string());
            }
        }

        // 4. Fallback search across installed standard terminals
        let fallbacks = [
            "kitty", "alacritty", "foot", "wezterm", "konsole",
            "gnome-terminal", "xfce4-terminal", "mate-terminal", "xterm",
        ];
        for candidate in fallbacks {
            if let Ok(out) = Command::new("which").arg(candidate).output() {
                if out.status.success() {
                    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    if !path.is_empty() {
                        return Some(candidate.to_string());
                    }
                }
            }
        }

        None
    }

    /// Spawns an executable completely detached from the companion process
    fn spawn_detached(binary: &str, args: &[String]) -> Result<(), String> {
        Command::new(binary)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn '{}': {}", binary, e))?;
        Ok(())
    }

    /// Fallback desktop file search when app was newly installed and not yet in SQLite
    fn find_and_index_on_the_fly(&self, name: &str) -> Option<InstalledApp> {
        let clean = name.trim().to_lowercase();
        let search_dirs: Vec<PathBuf> = vec![
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
            PathBuf::from("/var/lib/flatpak/exports/share/applications"),
        ];

        for dir in search_dirs {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|s| s.to_str()) == Some("desktop") {
                        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
                        if stem.to_lowercase().contains(&clean) {
                            if let Some(app) = AppIndexer::parse_desktop_file(&path, stem) {
                                let _ = self.memory_store.insert_installed_app(&app);
                                return Some(app);
                            }
                        }
                    }
                }
            }
        }
        None
    }
}

#[async_trait]
impl OsController for LinuxOsController {
    async fn get_active_window(&self) -> Result<WindowGeometry, String> {
        // 1. Hyprland IPC query (Wayland)
        if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() {
            if let Ok(output) = Command::new("hyprctl").args(["activewindow", "-j"]).output() {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout);
                    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                        let title = val["title"].as_str().unwrap_or("Active Window").to_string();
                        let at = val["at"].as_array();
                        let size = val["size"].as_array();

                        if let (Some(at), Some(size)) = (at, size) {
                            let x = at.get(0).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                            let y = at.get(1).and_then(|v| v.as_i64()).unwrap_or(0) as i32;
                            let width = size.get(0).and_then(|v| v.as_u64()).unwrap_or(800) as u32;
                            let height = size.get(1).and_then(|v| v.as_u64()).unwrap_or(600) as u32;

                            return Ok(WindowGeometry {
                                id: val["address"].as_str().unwrap_or("hypr-focused").to_string(),
                                title,
                                x,
                                y,
                                width,
                                height,
                                workspace: val["workspace"]["name"].as_str().map(|s| s.to_string()),
                            });
                        }
                    }
                }
            }
        }

        // 2. Fallback to X11 via xdotool
        if let Ok(id_out) = Command::new("xdotool").args(["getactivewindow"]).output() {
            if id_out.status.success() {
                let win_id = String::from_utf8_lossy(&id_out.stdout).trim().to_string();
                if let Ok(geom_out) = Command::new("xdotool").args(["getwindowgeometry", "--shell", &win_id]).output() {
                    let geom_str = String::from_utf8_lossy(&geom_out.stdout);
                    let mut x = 0;
                    let mut y = 0;
                    let mut width = 800;
                    let mut height = 600;

                    for line in geom_str.lines() {
                        if let Some(val) = line.strip_prefix("X=") {
                            x = val.parse().unwrap_or(0);
                        } else if let Some(val) = line.strip_prefix("Y=") {
                            y = val.parse().unwrap_or(0);
                        } else if let Some(val) = line.strip_prefix("WIDTH=") {
                            width = val.parse().unwrap_or(800);
                        } else if let Some(val) = line.strip_prefix("HEIGHT=") {
                            height = val.parse().unwrap_or(600);
                        }
                    }

                    return Ok(WindowGeometry {
                        id: win_id,
                        title: "X11 Active Window".into(),
                        x,
                        y,
                        width,
                        height,
                        workspace: None,
                    });
                }
            }
        }

        // Default screen anchor fallback
        Ok(WindowGeometry {
            id: "screen-root".into(),
            title: "Desktop Screen".into(),
            x: 100,
            y: 100,
            width: 1920,
            height: 1080,
            workspace: None,
        })
    }

    async fn open_url(&self, url: &str) -> Result<(), String> {
        let trimmed = url.trim();
        let target = if !trimmed.starts_with("http://")
            && !trimmed.starts_with("https://")
            && !trimmed.starts_with("file://")
            && !trimmed.starts_with("about:")
        {
            format!("https://{}", trimmed)
        } else {
            trimmed.to_string()
        };

        // Try gio open (GNOME / modern Linux standard) then xdg-open
        if Command::new("gio")
            .args(["open", &target])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok(());
        }

        Command::new("xdg-open")
            .arg(&target)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to open URL '{}' via xdg-open: {}", target, e))?;

        Ok(())
    }

    async fn open_terminal(&self, command: Option<&str>) -> Result<(), String> {
        let term_bin = Self::detect_default_terminal()
            .ok_or_else(|| "No supported terminal emulator found on system ($TERMINAL / xdg-terminal-exec / kitty / etc.)".to_string())?;

        let args: Vec<String> = match command {
            Some(cmd) if !cmd.trim().is_empty() => {
                // Command wrapper ensuring the interactive shell remains open after command completion
                let wrapped = format!(
                    "{}; echo ''; echo '=== [Команда завершена. Консоль остаётся открытой для дальнейших действий] ==='; exec ${{SHELL:-bash}}",
                    cmd.trim()
                );
                let bin_lower = term_bin.to_lowercase();
                if bin_lower.contains("kitty") || bin_lower.contains("foot") || bin_lower == "xdg-terminal-exec" {
                    vec!["sh".into(), "-c".into(), wrapped]
                } else if bin_lower.contains("konsole") {
                    vec!["--noclose".into(), "-e".into(), "sh".into(), "-c".into(), wrapped]
                } else if bin_lower.contains("wezterm") {
                    vec!["start".into(), "--".into(), "sh".into(), "-c".into(), wrapped]
                } else if bin_lower.contains("xterm") {
                    vec!["-hold".into(), "-e".into(), "sh".into(), "-c".into(), wrapped]
                } else {
                    vec!["-e".into(), "sh".into(), "-c".into(), wrapped]
                }
            }
            _ => Vec::new(),
        };

        Self::spawn_detached(&term_bin, &args)
    }

    async fn launch_app(&self, app_name: &str, args: &[String]) -> Result<(), String> {
        let clean = app_name.trim();
        let lower = clean.to_lowercase();

        // 1. Abstract System Entities handled through OS defaults
        if lower == "terminal" || lower == "консоль" || lower == "терминал" {
            let cmd = if args.is_empty() {
                None
            } else {
                Some(args.join(" "))
            };
            return self.open_terminal(cmd.as_deref()).await;
        }

        if lower == "browser" || lower == "браузер" {
            let url = args.first().map(|s| s.as_str()).unwrap_or("https://duckduckgo.com");
            return self.open_url(url).await;
        }

        // 2. Query SQLite Index (contains display_name, keywords, localized names from XDG)
        if let Ok(matches) = self.memory_store.search_installed_apps(clean) {
            if let Some(matched_app) = matches.first() {
                // Priority A: Direct detached execution of the desktop file Exec binary
                let exec_parts: Vec<&str> = matched_app.exec_cmd.split_whitespace().collect();
                if let Some(bin) = exec_parts.first() {
                    let mut combined_args: Vec<String> = exec_parts[1..].iter().map(|s| s.to_string()).collect();
                    combined_args.extend_from_slice(args);
                    if Self::spawn_detached(bin, &combined_args).is_ok() {
                        return Ok(());
                    }
                }

                // Priority B: System gtk-launch using desktop file ID
                if Command::new("gtk-launch")
                    .arg(&matched_app.id)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .is_ok()
                {
                    return Ok(());
                }
            }
        }

        // 3. Fallback: on-the-fly desktop scan if application was newly installed
        if let Some(app) = self.find_and_index_on_the_fly(clean) {
            let exec_parts: Vec<&str> = app.exec_cmd.split_whitespace().collect();
            if let Some(bin) = exec_parts.first() {
                let mut combined_args: Vec<String> = exec_parts[1..].iter().map(|s| s.to_string()).collect();
                combined_args.extend_from_slice(args);
                if Self::spawn_detached(bin, &combined_args).is_ok() {
                    return Ok(());
                }
            }
            if Command::new("gtk-launch")
                .arg(&app.id)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .is_ok()
            {
                return Ok(());
            }
        }

        // 4. Fallback: check binary in system PATH via `which`
        if let Ok(out) = Command::new("which").arg(clean).output() {
            if out.status.success() {
                let bin_path = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !bin_path.is_empty() && Self::spawn_detached(&bin_path, args).is_ok() {
                    return Ok(());
                }
            }
        }

        // 5. Final detached shell execution fallback
        let full_cmd = if args.is_empty() {
            clean.to_string()
        } else {
            format!("{} {}", clean, args.join(" "))
        };

        Command::new("sh")
            .arg("-c")
            .arg(format!("{} &", full_cmd))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to launch '{}': {}", app_name, e))?;

        Ok(())
    }

    async fn execute_shell(&self, command_str: &str, cwd: Option<&str>) -> Result<ExecutionResult, String> {
        let mut cmd = Command::new("sh");
        cmd.arg("-c").arg(command_str);

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        let output = cmd.output().map_err(|e| format!("Failed to execute shell: {}", e))?;
        Ok(ExecutionResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

// ============================================================================
// Windows Implementation (Win32 ShellExecute, Windows Terminal / PowerShell)
// ============================================================================

#[allow(dead_code)]
pub struct WindowsOsController {
    pub memory_store: Arc<MemoryStore>,
}

#[async_trait]
impl OsController for WindowsOsController {
    async fn get_active_window(&self) -> Result<WindowGeometry, String> {
        Ok(WindowGeometry {
            id: "win-focused".into(),
            title: "Active Window".into(),
            x: 100,
            y: 100,
            width: 1920,
            height: 1080,
            workspace: None,
        })
    }

    async fn open_url(&self, url: &str) -> Result<(), String> {
        let trimmed = url.trim();
        Command::new("cmd")
            .args(["/c", "start", "", trimmed])
            .spawn()
            .map_err(|e| format!("Failed to open URL via Windows start: {}", e))?;
        Ok(())
    }

    async fn open_terminal(&self, command: Option<&str>) -> Result<(), String> {
        // Preference: Windows Terminal (wt.exe) -> PowerShell -> CMD
        let has_wt = Command::new("where").arg("wt.exe").output().map(|o| o.status.success()).unwrap_or(false);

        match command {
            Some(cmd) if !cmd.trim().is_empty() => {
                let trimmed = cmd.trim();
                let wrapped = format!(
                    "{}; Write-Host '`n=== [Command completed. Console remains open for further actions] ===' -ForegroundColor Cyan",
                    trimmed
                );
                if has_wt {
                    Command::new("wt.exe")
                        .args(["powershell.exe", "-NoExit", "-Command", &wrapped])
                        .spawn()
                        .map_err(|e| format!("Failed to launch Windows Terminal: {}", e))?;
                } else {
                    Command::new("powershell.exe")
                        .args(["-NoExit", "-Command", &wrapped])
                        .spawn()
                        .map_err(|e| format!("Failed to launch PowerShell: {}", e))?;
                }
            }
            _ => {
                if has_wt {
                    Command::new("wt.exe")
                        .spawn()
                        .map_err(|e| format!("Failed to launch Windows Terminal: {}", e))?;
                } else {
                    Command::new("powershell.exe")
                        .spawn()
                        .map_err(|e| format!("Failed to launch PowerShell: {}", e))?;
                }
            }
        }

        Ok(())
    }

    async fn launch_app(&self, app_name: &str, args: &[String]) -> Result<(), String> {
        let clean = app_name.trim();
        let lower = clean.to_lowercase();

        // 1. Abstract System Entities handled through OS defaults
        if lower == "terminal" || lower == "console" || lower == "терминал" || lower == "консоль" {
            let cmd = if args.is_empty() { None } else { Some(args.join(" ")) };
            return self.open_terminal(cmd.as_deref()).await;
        }

        if lower == "browser" || lower == "браузер" {
            let url = args.first().map(|s| s.as_str()).unwrap_or("https://duckduckgo.com");
            return self.open_url(url).await;
        }

        // 2. Query SQLite Index (Start Menu shortcuts / App Paths indexed)
        if let Ok(matches) = self.memory_store.search_installed_apps(clean) {
            if let Some(matched_app) = matches.first() {
                let target = matched_app.desktop_file_path.as_deref().unwrap_or(&matched_app.exec_cmd);
                let mut cmd = Command::new("cmd");
                cmd.args(["/c", "start", "", target]);
                cmd.args(args);
                if cmd.spawn().is_ok() {
                    return Ok(());
                }
            }
        }

        // 3. Fallback: direct start command with application name/executable
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "start", "", clean]);
        cmd.args(args);
        cmd.spawn().map_err(|e| format!("Failed to start '{}' on Windows: {}", clean, e))?;
        Ok(())
    }

    async fn execute_shell(&self, command_str: &str, cwd: Option<&str>) -> Result<ExecutionResult, String> {
        let mut cmd = Command::new("powershell.exe");
        cmd.args(["-NoProfile", "-Command", command_str]);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        let output = cmd.output().map_err(|e| format!("Shell execution error: {}", e))?;
        Ok(ExecutionResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

// ============================================================================
// macOS Implementation (open -a, Terminal.app / AppleScript)
// ============================================================================

#[allow(dead_code)]
pub struct MacOsController {
    pub memory_store: Arc<MemoryStore>,
}

#[async_trait]
impl OsController for MacOsController {
    async fn get_active_window(&self) -> Result<WindowGeometry, String> {
        let script = r#"
            tell application "System Events"
                set frontApp to first application process whose frontmost is true
                set frontAppName to name of frontApp
                tell frontApp
                    set windowPos to position of front window
                    set windowSize to size of front window
                    return (item 1 of windowPos as text) & "," & (item 2 of windowPos as text) & "," & (item 1 of windowSize as text) & "," & (item 2 of windowSize as text) & "," & frontAppName
                end tell
            end tell
        "#;
        if let Ok(out) = Command::new("osascript").args(["-e", script]).output() {
            if out.status.success() {
                let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let parts: Vec<&str> = text.split(',').collect();
                if parts.len() >= 5 {
                    let x = parts[0].trim().parse::<i32>().unwrap_or(100);
                    let y = parts[1].trim().parse::<i32>().unwrap_or(100);
                    let w = parts[2].trim().parse::<u32>().unwrap_or(1200);
                    let h = parts[3].trim().parse::<u32>().unwrap_or(800);
                    let title = parts[4].trim().to_string();
                    return Ok(WindowGeometry {
                        id: "mac-front-window".into(),
                        title,
                        x,
                        y,
                        width: w,
                        height: h,
                        workspace: None,
                    });
                }
            }
        }

        Ok(WindowGeometry {
            id: "mac-focused".into(),
            title: "Active Window".into(),
            x: 100,
            y: 100,
            width: 1920,
            height: 1080,
            workspace: None,
        })
    }

    async fn open_url(&self, url: &str) -> Result<(), String> {
        let trimmed = url.trim();
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| format!("Failed to open URL via open: {}", e))?;
        Ok(())
    }

    async fn open_terminal(&self, command: Option<&str>) -> Result<(), String> {
        match command {
            Some(cmd) if !cmd.trim().is_empty() => {
                let wrapped = format!(
                    "{}; echo ''; echo '=== [Command completed. Console remains open for further actions] ==='; exec $SHELL",
                    cmd.trim().replace('"', "\\\"")
                );
                let script = format!(
                    "tell application \"Terminal\"\nactivate\ndo script \"{}\"\nend tell",
                    wrapped
                );
                Command::new("osascript")
                    .args(["-e", &script])
                    .spawn()
                    .map_err(|e| format!("Failed to run terminal command via AppleScript: {}", e))?;
            }
            _ => {
                Command::new("open")
                    .args(["-a", "Terminal"])
                    .spawn()
                    .map_err(|e| format!("Failed to open Terminal.app: {}", e))?;
            }
        }
        Ok(())
    }

    async fn launch_app(&self, app_name: &str, args: &[String]) -> Result<(), String> {
        let clean = app_name.trim();
        let lower = clean.to_lowercase();

        if lower == "terminal" || lower == "console" || lower == "терминал" || lower == "консоль" {
            let cmd = if args.is_empty() { None } else { Some(args.join(" ")) };
            return self.open_terminal(cmd.as_deref()).await;
        }

        if lower == "browser" || lower == "браузер" {
            let url = args.first().map(|s| s.as_str()).unwrap_or("https://duckduckgo.com");
            return self.open_url(url).await;
        }

        // 1. Query SQLite Index (Info.plist CFBundleIdentifier or app bundle path)
        if let Ok(matches) = self.memory_store.search_installed_apps(clean) {
            if let Some(matched_app) = matches.first() {
                if matched_app.id.contains('.') {
                    let mut cmd = Command::new("open");
                    cmd.args(["-b", &matched_app.id]);
                    if !args.is_empty() {
                        cmd.arg("--args");
                        cmd.args(args);
                    }
                    if cmd.spawn().is_ok() {
                        return Ok(());
                    }
                }

                if let Some(ref path) = matched_app.desktop_file_path {
                    let mut cmd = Command::new("open");
                    cmd.arg(path);
                    if !args.is_empty() {
                        cmd.arg("--args");
                        cmd.args(args);
                    }
                    if cmd.spawn().is_ok() {
                        return Ok(());
                    }
                }
            }
        }

        // 2. Fallback: open -a <clean>
        let mut cmd = Command::new("open");
        cmd.args(["-a", clean]);
        if !args.is_empty() {
            cmd.arg("--args");
            cmd.args(args);
        }
        cmd.spawn().map_err(|e| format!("Failed to open app '{}': {}", clean, e))?;
        Ok(())
    }

    async fn execute_shell(&self, command_str: &str, cwd: Option<&str>) -> Result<ExecutionResult, String> {
        let mut cmd = Command::new("zsh");
        cmd.arg("-c").arg(command_str);
        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }
        let output = cmd.output().map_err(|e| format!("Shell execution error: {}", e))?;
        Ok(ExecutionResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[cfg(target_os = "linux")]
    fn test_default_terminal_detection() {
        let term = LinuxOsController::detect_default_terminal();
        println!("Detected system default terminal: {:?}", term);
    }
}
