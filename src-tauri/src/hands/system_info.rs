// GNU General Public License v3.0
// Lightweight System Fingerprint and Context Gathering

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemProfile {
    pub os_name: String,
    pub os_version: String,
    pub desktop_env: String,
    pub session_type: String, // "Wayland" | "X11" | "Windows" | "macOS"
    pub user_name: String,
    pub default_shell: String,
}

pub fn get_system_profile() -> SystemProfile {
    // 1. OS and version
    #[cfg(target_os = "linux")]
    let (os_name, os_version) = {
        let mut name = "Linux".to_string();
        let mut version = "rolling".to_string();
        if let Ok(content) = std::fs::read_to_string("/etc/os-release") {
            for line in content.lines() {
                if let Some(val) = line.strip_prefix("NAME=") {
                    name = val.trim_matches('"').to_string();
                } else if let Some(val) = line.strip_prefix("VERSION_ID=") {
                    version = val.trim_matches('"').to_string();
                } else if version == "rolling" {
                    if let Some(val) = line.strip_prefix("PRETTY_NAME=") {
                        version = val.trim_matches('"').to_string();
                    }
                }
            }
        }
        (name, version)
    };

    #[cfg(target_os = "windows")]
    let (os_name, os_version) = ("Windows".to_string(), "NT".to_string());

    #[cfg(target_os = "macos")]
    let (os_name, os_version) = ("macOS".to_string(), "Darwin".to_string());

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    let (os_name, os_version) = (std::env::consts::OS.to_string(), "Unknown".to_string());

    // 2. Desktop Environment
    let desktop_env = std::env::var("XDG_CURRENT_DESKTOP")
        .or_else(|_| std::env::var("DESKTOP_SESSION"))
        .unwrap_or_else(|_| {
            #[cfg(target_os = "windows")]
            return "Windows Desktop".to_string();
            #[cfg(target_os = "macos")]
            return "Aqua".to_string();
            #[allow(unreachable_code)]
            "Unknown".to_string()
        });

    // 3. Session type (Wayland / X11 / Windows / macOS)
    let session_type = {
        #[cfg(target_os = "linux")]
        {
            if std::env::var("WAYLAND_DISPLAY").is_ok() {
                "Wayland".to_string()
            } else if std::env::var("DISPLAY").is_ok() {
                "X11".to_string()
            } else {
                "Headless / TTY".to_string()
            }
        }
        #[cfg(target_os = "windows")]
        {
            "Windows".to_string()
        }
        #[cfg(target_os = "macos")]
        {
            "macOS".to_string()
        }
        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        {
            "Unknown".to_string()
        }
    };

    // 4. User and Shell
    let user_name = std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "user".to_string());

    let default_shell = std::env::var("SHELL")
        .map(|s| {
            std::path::Path::new(&s)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&s)
                .to_string()
        })
        .unwrap_or_else(|_| {
            #[cfg(target_os = "windows")]
            return "powershell".to_string();
            #[allow(unreachable_code)]
            "sh".to_string()
        });

    SystemProfile {
        os_name,
        os_version,
        desktop_env,
        session_type,
        user_name,
        default_shell,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_system_profile() {
        let p = get_system_profile();
        println!("System Profile: {:?}", p);
        assert!(!p.os_name.is_empty());
        assert!(!p.user_name.is_empty());
    }
}
