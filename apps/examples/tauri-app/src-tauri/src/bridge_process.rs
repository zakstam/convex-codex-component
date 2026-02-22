use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;
use tokio::time::{timeout, Duration};

use crate::bridge_dispatch_generated::helper_command_for_tauri_command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActorContext {
    pub user_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HelperStartPayload {
    pub convex_url: String,
    pub actor: ActorContext,
    pub session_id: String,
    pub model: Option<String>,
    pub disabled_tools: Option<Vec<String>>,
    pub cwd: Option<String>,
    pub delta_throttle_ms: Option<u64>,
    pub save_stream_deltas: Option<bool>,
    pub thread_strategy: Option<String>,
    pub thread_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BridgeStateSnapshot {
    pub running: bool,
    pub persisted_thread_id: Option<String>,
    pub runtime_thread_id: Option<String>,
    pub local_thread_id: Option<String>,
    pub conversation_id: Option<String>,
    pub turn_id: Option<String>,
    pub last_error_code: Option<String>,
    pub last_error: Option<String>,
    pub disabled_tools: Vec<String>,
    pub pending_server_request_count: Option<u64>,
    pub ingest_enqueued_event_count: Option<u64>,
    pub ingest_skipped_event_count: Option<u64>,
    pub ingest_enqueued_by_kind: Option<Vec<IngestMetricEntry>>,
    pub ingest_skipped_by_kind: Option<Vec<IngestMetricEntry>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestMetricEntry {
    pub kind: String,
    pub count: u64,
}

#[derive(Default)]
pub struct AppBridgeState {
    pub runtime: BridgeRuntime,
}

#[derive(Default)]
pub struct BridgeRuntime {
    inner: Arc<Mutex<Option<BridgeProcess>>>,
    snapshot: Arc<Mutex<BridgeStateSnapshot>>,
}

struct BridgeProcess {
    stdin: ChildStdin,
    child: Child,
}

struct HelperLaunchSpec {
    command: PathBuf,
    args: Vec<String>,
    mode: &'static str,
}

impl BridgeRuntime {
    pub async fn start(&self, app: AppHandle, payload: HelperStartPayload) -> Result<(), String> {
        let has_running = { self.inner.lock().await.is_some() };
        if has_running {
            if self.send_to_helper(&app, "start", json!(payload)).await.is_ok() {
                return Ok(());
            }
            {
                let mut stale = self.inner.lock().await;
                *stale = None;
            }
        }

        let helper = resolve_helper_launch_spec(&app)?;
        let mut command = Command::new(&helper.command);
        for arg in &helper.args {
            command.arg(arg);
        }
        command.stdin(std::process::Stdio::piped());
        command.stdout(std::process::Stdio::piped());
        command.stderr(std::process::Stdio::piped());

        let mut child = command.spawn().map_err(|e| format!("failed to spawn helper: {e}"))?;
        let stdin = child.stdin.take().ok_or_else(|| "helper stdin unavailable".to_string())?;
        let stdout = child.stdout.take().ok_or_else(|| "helper stdout unavailable".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "helper stderr unavailable".to_string())?;

        {
            let snapshot = self.snapshot.clone();
            let app_handle = app.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stdout).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    handle_helper_line(&app_handle, &snapshot, &line).await;
                }
            });
        }

        {
            let snapshot = self.snapshot.clone();
            let app_handle = app.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if let Some(raw_line) = line.strip_prefix("[codex-bridge:raw-in] ") {
                        let _ = app_handle.emit(
                            "codex:global_message",
                            json!({ "kind": "protocol/raw_in", "line": raw_line }),
                        );
                        continue;
                    }
                    {
                        let mut next = snapshot.lock().await;
                        next.last_error = Some(line.clone());
                    }
                    let _ = app_handle.emit("codex:protocol_error", json!({ "message": line }));
                }
            });
        }

        {
            let mut inner = self.inner.lock().await;
            *inner = Some(BridgeProcess { stdin, child });
        }
        {
            let mut snap = self.snapshot.lock().await;
            snap.running = true;
        }
        app.emit("codex:bridge_state", json!({ "running": true, "helperMode": helper.mode }))
            .map_err(|e| format!("emit failed: {e}"))?;

        self.send_to_helper(&app, "start", json!(payload)).await
    }

    pub async fn forward_tauri_json_command(
        &self,
        app: AppHandle,
        tauri_command: &str,
        payload: serde_json::Value,
    ) -> Result<(), String> {
        self.forward_tauri_command(&app, tauri_command, payload).await
    }

    pub async fn stop(&self, app: AppHandle) -> Result<(), String> {
        let process = {
            let mut inner = self.inner.lock().await;
            inner.take()
        };
        if let Some(mut process) = process {
            let line = json!({ "type": "stop", "payload": {} }).to_string();
            let _ = process.stdin.write_all(line.as_bytes()).await;
            let _ = process.stdin.write_all(b"\n").await;
            let _ = process.stdin.flush().await;
            let waited = timeout(Duration::from_millis(1200), process.child.wait()).await;
            let needs_force_kill = match waited {
                Ok(Ok(_)) => false,
                Ok(Err(_)) => true,
                Err(_) => true,
            };
            if needs_force_kill {
                let _ = process.child.kill().await;
                let _ = timeout(Duration::from_millis(500), process.child.wait()).await;
            }
        }

        let mut snapshot = self.snapshot.lock().await;
        *snapshot = BridgeStateSnapshot::default();
        let _ = app.emit(
            "codex:bridge_state",
            json!({
                "running": false,
                "conversationId": null,
                "runtimeConversationId": null,
                "turnId": null,
                "pendingServerRequestCount": 0,
                "ingestEnqueuedEventCount": 0,
                "ingestSkippedEventCount": 0,
                "ingestEnqueuedByKind": [],
                "ingestSkippedByKind": [],
                "disabledTools": [],
                "lastErrorCode": null,
                "lastError": null
            }),
        );
        Ok(())
    }

    pub async fn snapshot(&self) -> BridgeStateSnapshot {
        self.snapshot.lock().await.clone()
    }

    async fn forward_tauri_command(
        &self,
        app: &AppHandle,
        tauri_command: &str,
        payload: serde_json::Value,
    ) -> Result<(), String> {
        let helper_command = helper_command_for_tauri_command(tauri_command)
            .ok_or_else(|| format!("No helper mapping configured for tauri command: {tauri_command}"))?;
        self.send_to_helper(app, helper_command, payload).await
    }

    async fn send_to_helper(&self, app: &AppHandle, command: &str, payload: serde_json::Value) -> Result<(), String> {
        let mut inner = self.inner.lock().await;
        let process = inner
            .as_mut()
            .ok_or_else(|| "bridge helper is not running. Start runtime first.".to_string())?;

        let line = json!({ "type": command, "payload": payload }).to_string();
        if let Err(error) = process.stdin.write_all(line.as_bytes()).await {
            let _ = process.child.kill().await;
            let _ = timeout(Duration::from_millis(500), process.child.wait()).await;
            *inner = None;
            self.record_helper_disconnect(app, format!("failed to write command: {error}"))
                .await;
            return Err(format!("failed to write command: {error}"));
        }
        if let Err(error) = process.stdin.write_all(b"\n").await {
            let _ = process.child.kill().await;
            let _ = timeout(Duration::from_millis(500), process.child.wait()).await;
            *inner = None;
            self.record_helper_disconnect(app, format!("failed to write newline: {error}"))
                .await;
            return Err(format!("failed to write newline: {error}"));
        }
        if let Err(error) = process.stdin.flush().await {
            let _ = process.child.kill().await;
            let _ = timeout(Duration::from_millis(500), process.child.wait()).await;
            *inner = None;
            self.record_helper_disconnect(app, format!("failed to flush helper stdin: {error}"))
                .await;
            return Err(format!("failed to flush helper stdin: {error}"));
        }
        Ok(())
    }

    async fn record_helper_disconnect(&self, app: &AppHandle, message: String) {
        let disabled_tools = {
            let mut snapshot = self.snapshot.lock().await;
            snapshot.running = false;
            snapshot.persisted_thread_id = None;
            snapshot.runtime_thread_id = None;
            snapshot.local_thread_id = None;
            snapshot.turn_id = None;
            snapshot.pending_server_request_count = Some(0);
            snapshot.ingest_enqueued_event_count = Some(0);
            snapshot.ingest_skipped_event_count = Some(0);
            snapshot.ingest_enqueued_by_kind = Some(Vec::new());
            snapshot.ingest_skipped_by_kind = Some(Vec::new());
            snapshot.last_error_code = None;
            snapshot.last_error = Some(message.clone());
            snapshot.disabled_tools.clone()
        };

        {
            let mut inner = self.inner.lock().await;
            *inner = None;
        }
        let _ = app.emit(
            "codex:bridge_state",
            json!({
                "running": false,
                "conversationId": null,
                "runtimeConversationId": null,
                "turnId": null,
                "pendingServerRequestCount": 0,
                "ingestEnqueuedEventCount": 0,
                "ingestSkippedEventCount": 0,
                "ingestEnqueuedByKind": [],
                "ingestSkippedByKind": [],
                "disabledTools": disabled_tools,
                "lastErrorCode": null,
                "lastError": message
            }),
        );
    }
}

fn resolve_helper_launch_spec(app: &AppHandle) -> Result<HelperLaunchSpec, String> {
    if let Ok(path) = std::env::var("CODEX_HELPER_BIN") {
        let bin_path = resolve_file_command(&path, "CODEX_HELPER_BIN")?;
        if bin_path.exists() {
            return Ok(HelperLaunchSpec {
                command: bin_path,
                args: vec![],
                mode: "standalone-binary",
            });
        }
    }

    let cwd = std::env::current_dir().map_err(|e| format!("current_dir failed: {e}"))?;
    let fallback_js = cwd.join("../dist-node/bridge-helper.js");

    // In tauri dev, the resource directory can hold stale copies from older runs.
    // Prefer the freshly built local JS helper to keep host/component schemas in sync.
    if cfg!(debug_assertions) && fallback_js.exists() {
        let node_bin = resolve_node_command()?;
        return Ok(HelperLaunchSpec {
            command: node_bin,
            args: vec![fallback_js.to_string_lossy().to_string()],
            mode: "node-js-dev-local",
        });
    }

    if let Ok(path) = app
        .path()
        .resolve("bridge-helper", tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            return Ok(HelperLaunchSpec {
                command: path,
                args: vec![],
                mode: "standalone-binary",
            });
        }
    }

    if let Ok(path) = app
        .path()
        .resolve("bridge-helper.exe", tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            return Ok(HelperLaunchSpec {
                command: path,
                args: vec![],
                mode: "standalone-binary",
            });
        }
    }

    if let Ok(path) = app
        .path()
        .resolve("bridge-helper.js", tauri::path::BaseDirectory::Resource)
    {
        if path.exists() {
            let node_bin = resolve_node_command()?;
            return Ok(HelperLaunchSpec {
                command: node_bin,
                args: vec![path.to_string_lossy().to_string()],
                mode: "node-js",
            });
        }
    }

    let fallback_bin = cwd.join("../dist-node/bridge-helper");
    if fallback_bin.exists() {
        return Ok(HelperLaunchSpec {
            command: fallback_bin,
            args: vec![],
            mode: "standalone-binary",
        });
    }
    let fallback_bin_exe = cwd.join("../dist-node/bridge-helper.exe");
    if fallback_bin_exe.exists() {
        return Ok(HelperLaunchSpec {
            command: fallback_bin_exe,
            args: vec![],
            mode: "standalone-binary",
        });
    }

    if fallback_js.exists() {
        let node_bin = resolve_node_command()?;
        return Ok(HelperLaunchSpec {
            command: node_bin,
            args: vec![fallback_js.to_string_lossy().to_string()],
            mode: "node-js",
        });
    }

    Err(
        "No helper runtime found. Build `dist-node/bridge-helper.js` or provide `CODEX_HELPER_BIN`."
            .to_string(),
    )
}

async fn handle_helper_line(app: &AppHandle, snapshot: &Arc<Mutex<BridgeStateSnapshot>>, line: &str) {
    let parsed: serde_json::Value = match serde_json::from_str(line) {
        Ok(value) => value,
        Err(error) => {
            {
                let mut next = snapshot.lock().await;
                next.last_error = Some(error.to_string());
            }
            let _ = app.emit(
                "codex:protocol_error",
                json!({ "message": format!("failed to parse helper line: {error}") }),
            );
            return;
        }
    };

    let kind = parsed
        .get("type")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown");

    match kind {
        "state" => {
            if let Some(payload) = parsed.get("payload") {
                if let Ok(next_state) = serde_json::from_value::<BridgeStateSnapshot>(payload.clone()) {
                    {
                        let mut current = snapshot.lock().await;
                        *current = next_state.clone();
                    }
                    let _ = app.emit("codex:bridge_state", payload.clone());
                }
            }
        }
        "event" => {
            if let Some(payload) = parsed.get("payload") {
                let _ = app.emit("codex:event", payload.clone());
            }
        }
        "global" => {
            if let Some(payload) = parsed.get("payload") {
                let _ = app.emit("codex:global_message", payload.clone());
            }
        }
        "protocol_error" | "error" => {
            if let Some(payload) = parsed.get("payload") {
                let message = payload
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("helper error")
                    .to_string();
                {
                    let mut next = snapshot.lock().await;
                    next.last_error = Some(message.clone());
                }
                let _ = app.emit("codex:protocol_error", payload.clone());
            }
        }
        _ => {}
    }
}

fn resolve_file_command(path: &str, env_name: &str) -> Result<PathBuf, String> {
    let candidate = path.trim();
    if candidate.is_empty() {
        return Err(format!("{env_name} cannot be empty"));
    }

    let candidate_path = Path::new(candidate);
    if is_explicit_path(candidate_path) {
        if !candidate_path.exists() {
            return Err(format!(
                "{env_name} must reference an existing file. Missing path: {candidate}"
            ));
        }
        if !candidate_path.is_file() {
            return Err(format!("{env_name} must reference a file: {candidate}"));
        }
        Ok(candidate_path.to_path_buf())
    } else {
        Ok(candidate_path.to_path_buf())
    }
}

fn resolve_node_command() -> Result<PathBuf, String> {
    let configured = std::env::var("CODEX_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let command = configured.trim();
    if command.is_empty() {
        return Err("CODEX_NODE_BIN cannot be empty".to_string());
    }

    let command_path = Path::new(command);
    if is_explicit_path(command_path) {
        if !command_path.exists() {
            return Err(format!(
                "CODEX_NODE_BIN points to a missing file: {}",
                command_path.to_string_lossy()
            ));
        }
        if !command_path.is_file() {
            return Err(format!("CODEX_NODE_BIN must point to a file: {command}"));
        }
        return Ok(command_path.to_path_buf());
    }

    if let Ok(canonical) = find_binary_in_path(command) {
        return Ok(canonical);
    }

    Err(format!(
        "Unable to find executable '{command}' in PATH. Set CODEX_NODE_BIN explicitly."
    ))
}

fn is_explicit_path(path: &Path) -> bool {
    if path.is_absolute() {
        return true;
    }
    let raw = path.to_string_lossy();
    raw.contains(std::path::MAIN_SEPARATOR)
        || raw.contains('/')
        || raw.contains('\\')
}

fn find_binary_in_path(command: &str) -> Result<PathBuf, String> {
    let path = std::env::var_os("PATH").ok_or_else(|| "PATH environment variable is not set".to_string())?;

    for path_dir in std::env::split_paths(&path) {
        let candidate = path_dir.join(command);
        if candidate.exists() {
            return Ok(candidate);
        }

        let path_with_exts: &[&str] = if cfg!(windows) {
            &[".exe", ".cmd", ".bat"]
        } else {
            &[""]
        };

        for suffix in path_with_exts {
            let candidate = path_dir.join(format!("{command}{suffix}"));
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    Err(format!("command '{command}' not found in PATH"))
}
