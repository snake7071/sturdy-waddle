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

        // 1. Memories Table
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

        // 2. Installed Desktop Applications Table (XDG / OS Index)
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

        Ok(())
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
