// GNU General Public License v3.0
// Dynamic Desktop Application Indexer & Fuzzy Matching

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledApp {
    pub id: String,
    pub display_name: String,
    pub exec_cmd: String,
    pub keywords: Option<String>,
    pub icon: Option<String>,
    pub desktop_file_path: Option<String>,
}

pub struct AppIndexer;

impl AppIndexer {
    /// Discovers and parses all installed desktop applications
    pub fn scan() -> Vec<InstalledApp> {
        #[cfg(target_os = "linux")]
        {
            Self::scan_linux()
        }
        #[cfg(target_os = "windows")]
        {
            Self::scan_windows()
        }
        #[cfg(target_os = "macos")]
        {
            Self::scan_macos()
        }
        #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
        {
            Vec::new()
        }
    }

    #[cfg(target_os = "linux")]
    fn scan_linux() -> Vec<InstalledApp> {
        let mut apps = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        let mut search_dirs: Vec<PathBuf> = vec![
            PathBuf::from("/usr/share/applications"),
            PathBuf::from("/usr/local/share/applications"),
            PathBuf::from("/var/lib/flatpak/exports/share/applications"),
        ];

        if let Ok(home) = std::env::var("HOME") {
            search_dirs.push(PathBuf::from(&home).join(".local/share/applications"));
            search_dirs.push(PathBuf::from(&home).join(".local/share/flatpak/exports/share/applications"));
        }

        if let Ok(xdg_data_dirs) = std::env::var("XDG_DATA_DIRS") {
            for dir in xdg_data_dirs.split(':') {
                let p = Path::new(dir).join("applications");
                if !search_dirs.contains(&p) {
                    search_dirs.push(p);
                }
            }
        }

        for dir in search_dirs {
            if !dir.is_dir() {
                continue;
            }

            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("desktop") {
                    continue;
                }

                let id = path.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                if id.is_empty() || seen_ids.contains(&id) {
                    continue;
                }

                if let Some(app) = Self::parse_desktop_file(&path, &id) {
                    seen_ids.insert(id);
                    apps.push(app);
                }
            }
        }

        apps
    }

    #[cfg(target_os = "linux")]
    pub fn parse_desktop_file(path: &Path, id: &str) -> Option<InstalledApp> {
        let content = std::fs::read_to_string(path).ok()?;
        let mut is_desktop_entry = false;
        let mut is_application = false;
        let mut no_display = false;

        let mut name: Option<String> = None;
        let mut generic_name: Option<String> = None;
        let mut exec: Option<String> = None;
        let mut keywords: Option<String> = None;
        let mut icon: Option<String> = None;
        let mut extra_metadata: Vec<String> = Vec::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') {
                if trimmed == "[Desktop Entry]" {
                    is_desktop_entry = true;
                } else {
                    // Stop parsing once we hit secondary sections like [Desktop Action ...]
                    break;
                }
                continue;
            }

            if !is_desktop_entry {
                continue;
            }

            if let Some(val) = trimmed.strip_prefix("Type=") {
                if val.trim().eq_ignore_ascii_case("Application") {
                    is_application = true;
                }
            } else if let Some(val) = trimmed.strip_prefix("NoDisplay=") {
                if val.trim().eq_ignore_ascii_case("true") {
                    no_display = true;
                }
            } else if let Some(val) = trimmed.strip_prefix("Name=") {
                if name.is_none() {
                    name = Some(val.trim().to_string());
                }
            } else if trimmed.starts_with("Name[") {
                if let Some((_, val)) = trimmed.split_once('=') {
                    let clean_val = val.trim();
                    if !clean_val.is_empty() {
                        extra_metadata.push(clean_val.to_string());
                    }
                }
            } else if let Some(val) = trimmed.strip_prefix("GenericName=") {
                if generic_name.is_none() {
                    generic_name = Some(val.trim().to_string());
                }
            } else if trimmed.starts_with("GenericName[") {
                if let Some((_, val)) = trimmed.split_once('=') {
                    let clean_val = val.trim();
                    if !clean_val.is_empty() {
                        extra_metadata.push(clean_val.to_string());
                    }
                }
            } else if let Some(val) = trimmed.strip_prefix("Exec=") {
                if exec.is_none() {
                    // Clean placeholder arguments like %u, %U, %f, %F, %i, %c, %k and dangling flags like '--'
                    let mut cleaned: Vec<&str> = val
                        .split_whitespace()
                        .filter(|token| !token.starts_with('%'))
                        .collect();
                    if let Some(last) = cleaned.last() {
                        if *last == "--" {
                            cleaned.pop();
                        }
                    }
                    exec = Some(cleaned.join(" "));
                }
            } else if let Some(val) = trimmed.strip_prefix("Keywords=") {
                if keywords.is_none() {
                    keywords = Some(val.trim().replace(';', " "));
                }
            } else if trimmed.starts_with("Keywords[") {
                if let Some((_, val)) = trimmed.split_once('=') {
                    extra_metadata.push(val.trim().replace(';', " "));
                }
            } else if let Some(val) = trimmed.strip_prefix("Comment=") {
                let clean_val = val.trim();
                if !clean_val.is_empty() {
                    extra_metadata.push(clean_val.to_string());
                }
            } else if trimmed.starts_with("Comment[") {
                if let Some((_, val)) = trimmed.split_once('=') {
                    let clean_val = val.trim();
                    if !clean_val.is_empty() {
                        extra_metadata.push(clean_val.to_string());
                    }
                }
            } else if let Some(val) = trimmed.strip_prefix("StartupWMClass=") {
                let clean_val = val.trim();
                if !clean_val.is_empty() {
                    extra_metadata.push(clean_val.to_string());
                }
            } else if let Some(val) = trimmed.strip_prefix("Icon=") {
                if icon.is_none() {
                    icon = Some(val.trim().to_string());
                }
            }
        }

        // Must be an application and not hidden via NoDisplay
        if (!is_application && !content.contains("Exec=")) || no_display {
            return None;
        }

        let display_name = name.or(generic_name.clone())?;
        let exec_cmd = exec?;

        let mut combined_keywords = Vec::new();
        if let Some(kw) = keywords {
            combined_keywords.push(kw);
        }
        if let Some(gn) = generic_name {
            combined_keywords.push(gn);
        }
        combined_keywords.extend(extra_metadata);

        Some(InstalledApp {
            id: id.to_string(),
            display_name,
            exec_cmd,
            keywords: if combined_keywords.is_empty() {
                None
            } else {
                Some(combined_keywords.join(" "))
            },
            icon,
            desktop_file_path: Some(path.to_string_lossy().to_string()),
        })
    }

    #[cfg(target_os = "windows")]
    fn scan_windows() -> Vec<InstalledApp> {
        let mut apps = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        let mut search_dirs = Vec::new();

        // 1. All Users Start Menu Programs
        if let Ok(prog_data) = std::env::var("ProgramData") {
            search_dirs.push(PathBuf::from(prog_data).join("Microsoft").join("Windows").join("Start Menu").join("Programs"));
        } else if let Ok(all_users) = std::env::var("ALLUSERSPROFILE") {
            search_dirs.push(PathBuf::from(all_users).join("Microsoft").join("Windows").join("Start Menu").join("Programs"));
        }

        // 2. Current User Start Menu Programs
        if let Ok(app_data) = std::env::var("APPDATA") {
            search_dirs.push(PathBuf::from(app_data).join("Microsoft").join("Windows").join("Start Menu").join("Programs"));
        }

        fn walk_shortcuts(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
            if depth > 3 {
                return;
            }
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() {
                        walk_shortcuts(&path, depth + 1, out);
                    } else if path.extension().and_then(|s| s.to_str()).map(|e| e.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
                        out.push(path);
                    }
                }
            }
        }

        let mut shortcuts = Vec::new();
        for dir in search_dirs {
            if dir.is_dir() {
                walk_shortcuts(&dir, 0, &mut shortcuts);
            }
        }

        for lnk in shortcuts {
            let stem = match lnk.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.trim().to_string(),
                None => continue,
            };

            let stem_lower = stem.to_lowercase();
            if stem_lower.contains("uninstall") || stem_lower.contains("help") || stem_lower.contains("read me") || stem_lower.contains("documentation") {
                continue;
            }

            if seen_names.contains(&stem_lower) {
                continue;
            }

            seen_names.insert(stem_lower.clone());
            let path_str = lnk.to_string_lossy().to_string();

            apps.push(InstalledApp {
                id: stem_lower,
                display_name: stem.clone(),
                exec_cmd: path_str.clone(),
                keywords: Some(format!("windows app shortcut {}", stem)),
                icon: None,
                desktop_file_path: Some(path_str),
            });
        }

        apps
    }

    #[cfg(target_os = "macos")]
    fn scan_macos() -> Vec<InstalledApp> {
        let mut apps = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        let mut search_dirs = vec![
            PathBuf::from("/Applications"),
            PathBuf::from("/System/Applications"),
            PathBuf::from("/System/Applications/Utilities"),
        ];

        if let Ok(home) = std::env::var("HOME") {
            search_dirs.push(PathBuf::from(home).join("Applications"));
        }

        for dir in search_dirs {
            if !dir.is_dir() {
                continue;
            }

            let entries = match std::fs::read_dir(&dir) {
                Ok(e) => e,
                Err(_) => continue,
            };

            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|s| s.to_str()) != Some("app") {
                    continue;
                }

                let folder_stem = match path.file_stem().and_then(|s| s.to_str()) {
                    Some(s) => s.trim().to_string(),
                    None => continue,
                };

                let mut bundle_id: Option<String> = None;
                let mut display_name = folder_stem.clone();

                let info_plist = path.join("Contents").join("Info.plist");
                if info_plist.is_file() {
                    if let Ok(content) = std::fs::read_to_string(&info_plist) {
                        if let Some(pos) = content.find("CFBundleIdentifier") {
                            if let Some(str_start) = content[pos..].find("<string>") {
                                if let Some(str_end) = content[pos + str_start..].find("</string>") {
                                    let id = &content[pos + str_start + 8..pos + str_start + str_end];
                                    bundle_id = Some(id.trim().to_string());
                                }
                            }
                        }
                        if let Some(pos) = content.find("CFBundleDisplayName") {
                            if let Some(str_start) = content[pos..].find("<string>") {
                                if let Some(str_end) = content[pos + str_start..].find("</string>") {
                                    let name = &content[pos + str_start + 8..pos + str_start + str_end];
                                    let clean_name = name.trim();
                                    if !clean_name.is_empty() {
                                        display_name = clean_name.to_string();
                                    }
                                }
                            }
                        }
                    }
                }

                let id = bundle_id.unwrap_or_else(|| folder_stem.to_lowercase());
                if seen_ids.contains(&id) {
                    continue;
                }
                seen_ids.insert(id.clone());

                let path_str = path.to_string_lossy().to_string();
                apps.push(InstalledApp {
                    id,
                    display_name: display_name.clone(),
                    exec_cmd: folder_stem.clone(),
                    keywords: Some(format!("macOS bundle {}", display_name)),
                    icon: None,
                    desktop_file_path: Some(path_str),
                });
            }
        }

        apps
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_app_indexer_scans_apps() {
        let apps = AppIndexer::scan();
        assert!(!apps.is_empty(), "AppIndexer should discover installed applications");
        println!("Discovered {} apps", apps.len());
        let has_telegram = apps.iter().any(|a| a.id.to_lowercase().contains("telegram") || a.display_name.to_lowercase().contains("telegram"));
        println!("Found Telegram desktop entry: {}", has_telegram);
    }
}
