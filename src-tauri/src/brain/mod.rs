// GNU General Public License v3.0
// Long-Term Tiered Memory Store (SQLite via rusqlite) & App Index Cache

use crate::hands::indexer::InstalledApp;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryItem {
    pub id: Option<i64>,
    pub key: String,
    pub category: String, // "preference", "fact", "project", "summary"
    pub content: String,
    pub tags: Vec<String>,
    pub updated_at: u64,
}

pub struct MemoryStore {
    conn: Mutex<Connection>,
}

impl MemoryStore {
    pub fn new(db_path: &str) -> Result<Self, rusqlite::Error> {
        let conn = Connection::open(db_path)?;

        // 1. Memories Table (Unified Master Store)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                category TEXT NOT NULL,
                content TEXT NOT NULL,
                tags TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);",
            [],
        )?;

        // 2. User Profile Table (Persistent Preferences & Identity)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS user_profile (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            [],
        )?;

        // 3. Facts Table (Long-Term User/World Facts)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                key TEXT UNIQUE NOT NULL,
                fact TEXT NOT NULL,
                tags TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            [],
        )?;

        // 4. Project Notes Table (Project-Specific Knowledge & Rules)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS project_notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                project_name TEXT NOT NULL,
                note TEXT NOT NULL,
                tags TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );",
            [],
        )?;

        // 5. Installed Desktop Applications Table (XDG / OS Index)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS installed_apps (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                exec_cmd TEXT NOT NULL,
                keywords TEXT,
                icon TEXT,
                desktop_file_path TEXT
            );",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_apps_name ON installed_apps(display_name);",
            [],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn save(&self, item: MemoryItem) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let tags_json = serde_json::to_string(&item.tags).unwrap_or_else(|_| "[]".into());

        // 1. Save to primary memories table
        conn.execute(
            "INSERT INTO memories (key, category, content, tags, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(key) DO UPDATE SET
                category = excluded.category,
                content = excluded.content,
                tags = excluded.tags,
                updated_at = excluded.updated_at;",
            params![item.key, item.category, item.content, tags_json, now],
        )
        .map_err(|e| format!("Database error saving memory: {}", e))?;

        // 2. Synchronize to specialized tables
        match item.category.to_lowercase().as_str() {
            "profile" | "preference" => {
                let _ = conn.execute(
                    "INSERT INTO user_profile (key, value, updated_at)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(key) DO UPDATE SET
                        value = excluded.value,
                        updated_at = excluded.updated_at;",
                    params![item.key, item.content, now],
                );
            }
            "fact" => {
                let _ = conn.execute(
                    "INSERT INTO facts (key, fact, tags, updated_at)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(key) DO UPDATE SET
                        fact = excluded.fact,
                        tags = excluded.tags,
                        updated_at = excluded.updated_at;",
                    params![item.key, item.content, tags_json, now],
                );
            }
            "project" => {
                let _ = conn.execute(
                    "INSERT INTO project_notes (project_name, note, tags, updated_at)
                     VALUES (?1, ?2, ?3, ?4);",
                    params![item.key, item.content, tags_json, now],
                );
            }
            _ => {}
        }

        Ok(())
    }

    pub fn delete(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let key_opt: Option<String> = conn
            .query_row("SELECT key FROM memories WHERE id = ?1", params![id], |r| r.get(0))
            .ok();

        conn.execute("DELETE FROM memories WHERE id = ?1;", params![id])
            .map_err(|e| format!("Error deleting memory: {}", e))?;

        if let Some(key) = key_opt {
            let _ = conn.execute("DELETE FROM user_profile WHERE key = ?1;", params![key]);
            let _ = conn.execute("DELETE FROM facts WHERE key = ?1;", params![key]);
            let _ = conn.execute("DELETE FROM project_notes WHERE project_name = ?1;", params![key]);
        }

        Ok(())
    }

    pub fn delete_by_key(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM memories WHERE key = ?1;", params![key])
            .map_err(|e| format!("Error deleting memory: {}", e))?;
        let _ = conn.execute("DELETE FROM user_profile WHERE key = ?1;", params![key]);
        let _ = conn.execute("DELETE FROM facts WHERE key = ?1;", params![key]);
        let _ = conn.execute("DELETE FROM project_notes WHERE project_name = ?1;", params![key]);
        Ok(())
    }

    pub fn get_all(&self) -> Result<Vec<MemoryItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, key, category, content, tags, updated_at FROM memories ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;

        let items = stmt
            .query_map([], |row| {
                let tags_str: String = row.get(4)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(MemoryItem {
                    id: Some(row.get(0)?),
                    key: row.get(1)?,
                    category: row.get(2)?,
                    content: row.get(3)?,
                    tags,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items)
    }

    pub fn get_relevant_context(&self, query: &str) -> Result<String, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // 1. Fetch user preferences & profile rules (always included to ensure prompt alignment)
        let mut pref_stmt = conn
            .prepare("SELECT key, content FROM memories WHERE category IN ('preference', 'profile') ORDER BY updated_at DESC LIMIT 10")
            .map_err(|e| e.to_string())?;

        let preferences: Vec<(String, String)> = pref_stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // 2. Extract meaningful search keywords from query
        let query_clean = query.to_lowercase();
        let stop_words = [
            "это", "как", "что", "где", "когда", "почему", "зачем", "мне", "для", "или",
            "подскажи", "пожалуйста", "how", "what", "the", "and", "for", "with", "from",
        ];
        let tokens: Vec<&str> = query_clean
            .split_whitespace()
            .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric()))
            .filter(|w| w.len() >= 3 && !stop_words.contains(w))
            .collect();

        let mut relevant_facts: Vec<(String, String)> = Vec::new();

        if !tokens.is_empty() {
            let mut conditions = Vec::new();
            let mut param_values = Vec::new();
            for token in tokens.iter().take(5) {
                conditions.push("(LOWER(key) LIKE ? OR LOWER(content) LIKE ? OR LOWER(tags) LIKE ?)");
                let pattern = format!("%{}%", token);
                param_values.push(pattern.clone());
                param_values.push(pattern.clone());
                param_values.push(pattern);
            }

            let sql = format!(
                "SELECT key, content FROM memories 
                 WHERE category NOT IN ('preference', 'profile') 
                   AND ({}) 
                 ORDER BY updated_at DESC LIMIT 8",
                conditions.join(" OR ")
            );

            if let Ok(mut stmt) = conn.prepare(&sql) {
                let params_ref: Vec<&dyn rusqlite::ToSql> =
                    param_values.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
                if let Ok(rows) = stmt.query_map(params_ref.as_slice(), |row| {
                    Ok((row.get(0)?, row.get(1)?))
                }) {
                    for r in rows.flatten() {
                        if !relevant_facts.iter().any(|(k, _)| k == &r.0) {
                            relevant_facts.push(r);
                        }
                    }
                }
            }
        }

        if preferences.is_empty() && relevant_facts.is_empty() {
            return Ok(String::new());
        }

        let mut out = String::from("RELEVANT PERSISTENT KNOWLEDGE (from companion_memory.db):\n");

        if !preferences.is_empty() {
            out.push_str("User Preferences & Rules (Strictly obey):\n");
            for (key, content) in &preferences {
                out.push_str(&format!("- [{}] {}\n", key, content));
            }
        }

        if !relevant_facts.is_empty() {
            out.push_str("Relevant Remembered Facts & Projects:\n");
            for (key, content) in &relevant_facts {
                out.push_str(&format!("- [{}] {}\n", key, content));
            }
        }

        Ok(out)
    }

    pub fn query_by_category(&self, category: &str) -> Result<Vec<MemoryItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, key, category, content, tags, updated_at FROM memories WHERE category = ?1 ORDER BY updated_at DESC")
            .map_err(|e| e.to_string())?;

        let items = stmt
            .query_map(params![category], |row| {
                let tags_str: String = row.get(4)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(MemoryItem {
                    id: Some(row.get(0)?),
                    key: row.get(1)?,
                    category: row.get(2)?,
                    content: row.get(3)?,
                    tags,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items)
    }

    pub fn search(&self, keyword: &str) -> Result<Vec<MemoryItem>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let pattern = format!("%{}%", keyword);
        let mut stmt = conn
            .prepare(
                "SELECT id, key, category, content, tags, updated_at 
                 FROM memories 
                 WHERE key LIKE ?1 OR content LIKE ?1 OR tags LIKE ?1 
                 ORDER BY updated_at DESC LIMIT 10",
            )
            .map_err(|e| e.to_string())?;

        let items = stmt
            .query_map(params![pattern], |row| {
                let tags_str: String = row.get(4)?;
                let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();
                Ok(MemoryItem {
                    id: Some(row.get(0)?),
                    key: row.get(1)?,
                    category: row.get(2)?,
                    content: row.get(3)?,
                    tags,
                    updated_at: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items)
    }

    pub fn purge_old_summaries(&self, retain_count: usize) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let deleted = conn
            .execute(
                "DELETE FROM memories WHERE id NOT IN (
                    SELECT id FROM memories WHERE category = 'summary' ORDER BY updated_at DESC LIMIT ?1
                 ) AND category = 'summary';",
                params![retain_count as i64],
            )
            .map_err(|e| e.to_string())?;
        Ok(deleted)
    }

    // ========================================================================
    // Installed Desktop Applications Management
    // ========================================================================

    pub fn count_installed_apps(&self) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM installed_apps", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count as usize)
    }

    pub fn upsert_installed_apps(&self, apps: &[InstalledApp]) -> Result<usize, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let mut inserted = 0;
        {
            let mut stmt = tx
                .prepare(
                    "INSERT INTO installed_apps (id, display_name, exec_cmd, keywords, icon, desktop_file_path)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(id) DO UPDATE SET
                        display_name = excluded.display_name,
                        exec_cmd = excluded.exec_cmd,
                        keywords = excluded.keywords,
                        icon = excluded.icon,
                        desktop_file_path = excluded.desktop_file_path;",
                )
                .map_err(|e| e.to_string())?;

            for app in apps {
                if stmt
                    .execute(params![
                        app.id,
                        app.display_name,
                        app.exec_cmd,
                        app.keywords,
                        app.icon,
                        app.desktop_file_path
                    ])
                    .is_ok()
                {
                    inserted += 1;
                }
            }
        }

        // Save last indexed timestamp into memories using sqlite datetime
        let _ = tx.execute(
            "INSERT INTO memories (key, category, content, tags, updated_at)
             VALUES ('sys_index_last_updated', 'system', datetime('now', 'localtime'), '[\"system\", \"index\"]', strftime('%s', 'now'))
             ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at;",
            [],
        );

        tx.commit().map_err(|e| e.to_string())?;
        Ok(inserted)
    }

    pub fn search_installed_apps(&self, query: &str) -> Result<Vec<InstalledApp>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let clean = query.trim().to_lowercase();
        let pattern = format!("%{}%", clean);

        let mut stmt = conn
            .prepare(
                "SELECT id, display_name, exec_cmd, keywords, icon, desktop_file_path
                 FROM installed_apps
                 WHERE LOWER(display_name) LIKE ?1 
                    OR LOWER(keywords) LIKE ?1 
                    OR LOWER(id) LIKE ?1
                 ORDER BY 
                    CASE 
                        WHEN LOWER(display_name) = ?2 THEN 1
                        WHEN LOWER(id) = ?2 THEN 2
                        WHEN LOWER(display_name) LIKE ?2 || '%' THEN 3
                        ELSE 4 
                    END
                 LIMIT 15;",
            )
            .map_err(|e| e.to_string())?;

        let items = stmt
            .query_map(params![pattern, clean], |row| {
                Ok(InstalledApp {
                    id: row.get(0)?,
                    display_name: row.get(1)?,
                    exec_cmd: row.get(2)?,
                    keywords: row.get(3)?,
                    icon: row.get(4)?,
                    desktop_file_path: row.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        Ok(items)
    }

    pub fn insert_installed_app(&self, app: &InstalledApp) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO installed_apps (id, display_name, exec_cmd, keywords, icon, desktop_file_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                exec_cmd = excluded.exec_cmd,
                keywords = excluded.keywords,
                icon = excluded.icon,
                desktop_file_path = excluded.desktop_file_path;",
            params![
                app.id,
                app.display_name,
                app.exec_cmd,
                app.keywords,
                app.icon,
                app.desktop_file_path
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_last_index_time(&self) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let res = conn.query_row(
            "SELECT content FROM memories WHERE key = 'sys_index_last_updated'",
            [],
            |row| row.get(0),
        );
        match res {
            Ok(val) => Ok(Some(val)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_memory_store_three_layers() {
        let store = MemoryStore::new(":memory:").expect("Failed to create in-memory SQLite");

        // 1. Save user preference (rule)
        let pref = MemoryItem {
            id: None,
            key: "no_emojis".to_string(),
            category: "preference".to_string(),
            content: "Не использовать эмодзи в ответах ассистента".to_string(),
            tags: vec!["rules".to_string(), "formatting".to_string()],
            updated_at: 1000,
        };
        store.save(pref).expect("Failed to save preference");

        // 2. Save user fact
        let fact = MemoryItem {
            id: None,
            key: "backend_rust".to_string(),
            category: "fact".to_string(),
            content: "Я пишу бекенд на Rust с использованием Tokio и Axum".to_string(),
            tags: vec!["rust".to_string(), "backend".to_string()],
            updated_at: 2000,
        };
        store.save(fact).expect("Failed to save fact");

        // 3. Save project note
        let proj = MemoryItem {
            id: None,
            key: "project_capri".to_string(),
            category: "project".to_string(),
            content: "Проект десктопного компаньона Capri с архитектурой памяти".to_string(),
            tags: vec!["project".to_string(), "tauri".to_string()],
            updated_at: 3000,
        };
        store.save(proj).expect("Failed to save project");

        // Verify get_all returns all 3 items
        let all = store.get_all().expect("Failed to fetch all");
        assert_eq!(all.len(), 3);

        // Verify specialized tables synchronization
        let conn = store.conn.lock().unwrap();
        let user_prof_val: String = conn
            .query_row("SELECT value FROM user_profile WHERE key = 'no_emojis'", [], |r| r.get(0))
            .expect("Preference was not synced to user_profile table");
        assert_eq!(user_prof_val, "Не использовать эмодзи в ответах ассистента");

        let fact_val: String = conn
            .query_row("SELECT fact FROM facts WHERE key = 'backend_rust'", [], |r| r.get(0))
            .expect("Fact was not synced to facts table");
        assert!(fact_val.contains("Rust"));

        let proj_note: String = conn
            .query_row("SELECT note FROM project_notes WHERE project_name = 'project_capri'", [], |r| r.get(0))
            .expect("Project was not synced to project_notes table");
        assert!(proj_note.contains("Capri"));
        drop(conn);

        // Verify relevant context retrieval
        // Query that mentions rust should get both the preference AND the rust fact
        let ctx = store.get_relevant_context("Посоветуй библиотеку для rust").expect("Context search failed");
        assert!(ctx.contains("no_emojis"), "Context must contain strict preference");
        assert!(ctx.contains("backend_rust"), "Context must match relevant fact");

        // Query about cooking should still contain strict preference (no_emojis)
        let ctx_other = store.get_relevant_context("Как приготовить пиццу?").expect("Context search failed");
        assert!(ctx_other.contains("no_emojis"), "Context must strictly include rules for all queries");

        // Test deletion
        let id_to_delete = all[0].id.unwrap();
        store.delete(id_to_delete).expect("Delete failed");
        let all_after = store.get_all().expect("Failed fetch after delete");
        assert_eq!(all_after.len(), 2);
    }
}
