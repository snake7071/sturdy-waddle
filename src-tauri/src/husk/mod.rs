// GNU General Public License v3.0
// Production-Ready Husk Mode Local IPC Server

use serde::{Deserialize, Serialize};
#[cfg(unix)]
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HuskEventPayload {
    pub state: String,           // "busy", "error", "needs_approval", "done", "idle"
    pub action: Option<String>,   // e.g. "editing_file", "test_failed", "building"
    pub message: Option<String>,  // Human readable hint: "Running cargo test..."
    pub source: Option<String>,   // "claude_code", "cargo", "npm", "shell"
    pub timestamp: u64,
}

pub const UNIX_SOCKET_PATH: &str = "/tmp/mascot-husk.sock";

#[cfg(unix)]
pub async fn start_husk_listener(app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::net::UnixListener;
    use tokio::io::AsyncBufReadExt;

    let socket_path = Path::new(UNIX_SOCKET_PATH);
    if socket_path.exists() {
        let _ = tokio::fs::remove_file(socket_path).await;
    }

    let listener = UnixListener::bind(socket_path)?;
    println!("[HuskMode] Unix Domain Socket active at {}", UNIX_SOCKET_PATH);

    loop {
        match listener.accept().await {
            Ok((stream, _addr)) => {
                let handle = app_handle.clone();
                tokio::spawn(async move {
                    let (reader, _) = stream.into_split();
                    let mut lines = tokio::io::BufReader::new(reader).lines();

                    while let Ok(Some(line)) = lines.next_line().await {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }

                        match serde_json::from_str::<HuskEventPayload>(trimmed) {
                            Ok(event) => {
                                println!("[HuskMode] Received event: state={}, action={:?}", event.state, event.action);
                                let _ = handle.emit("husk-event", &event);
                            }
                            Err(err) => {
                                // Support raw string fallback: e.g. "busy:building"
                                println!("[HuskMode] Raw message fallback: '{}' (error: {})", trimmed, err);
                                let fallback = HuskEventPayload {
                                    state: if trimmed.contains("fail") || trimmed.contains("error") {
                                        "error".into()
                                    } else if trimmed.contains("confirm") || trimmed.contains("approve") {
                                        "needs_approval".into()
                                    } else if trimmed.contains("done") || trimmed.contains("pass") {
                                        "done".into()
                                    } else {
                                        "busy".into()
                                    },
                                    action: Some("raw_input".into()),
                                    message: Some(trimmed.to_string()),
                                    source: Some("external_socket".into()),
                                    timestamp: std::time::SystemTime::now()
                                        .duration_since(std::time::UNIX_EPOCH)
                                        .unwrap_or_default()
                                        .as_secs(),
                                };
                                let _ = handle.emit("husk-event", &fallback);
                            }
                        }
                    }
                });
            }
            Err(err) => {
                eprintln!("[HuskMode] Socket accept error: {}", err);
            }
        }
    }
}

#[cfg(windows)]
pub async fn start_husk_listener(app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use tokio::net::windows::named_pipe::ServerOptions;
    use tokio::io::AsyncBufReadExt;

    const PIPE_NAME: &str = r"\\.\pipe\mascot-husk";
    println!("[HuskMode] Named Pipe active at {}", PIPE_NAME);

    loop {
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .create(PIPE_NAME)?;

        server.connect().await?;
        let handle = app_handle.clone();

        tokio::spawn(async move {
            let (reader, _) = tokio::io::split(server);
            let mut lines = tokio::io::BufReader::new(reader).lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if let Ok(event) = serde_json::from_str::<HuskEventPayload>(line.trim()) {
                    let _ = handle.emit("husk-event", &event);
                }
            }
        });
    }
}
