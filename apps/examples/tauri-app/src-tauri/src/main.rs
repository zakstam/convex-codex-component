mod bridge_process;
mod bridge_contract_generated;
mod bridge_dispatch_generated;
include!("bridge_invoke_handlers_generated.rs");

use bridge_process::{AppBridgeState, BridgeRuntime};
use bridge_contract_generated::{BRIDGE_COMMANDS, HELPER_COMMANDS};
use bridge_dispatch_generated::HELPER_FORWARD_TAURI_COMMANDS;
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, RunEvent, State, WindowEvent};

static START_TRACE_SEQ: AtomicU64 = AtomicU64::new(1);

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartBridgeConfig {
    convex_url: String,
    actor: bridge_process::ActorContext,
    session_id: String,
    start_source: Option<String>,
    model: Option<String>,
    cwd: Option<String>,
    disabled_tools: Option<Vec<String>>,
    delta_throttle_ms: Option<u64>,
    save_stream_deltas: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenThreadConfig {
    strategy: String,
    thread_id: Option<String>,
    model: Option<String>,
    cwd: Option<String>,
    dynamic_tools: Option<serde_json::Value>,
}

#[tauri::command]
async fn start_bridge(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: StartBridgeConfig,
) -> Result<(), String> {
    let trace_id = START_TRACE_SEQ.fetch_add(1, Ordering::Relaxed);
    let source = config
        .start_source
        .clone()
        .unwrap_or_else(|| "unspecified".to_string());
    let snapshot_before = state.runtime.snapshot().await;

    let _ = app.emit(
        "codex:global_message",
        serde_json::json!({
            "kind": "bridge/start_trace",
            "phase": "received",
            "traceId": trace_id,
            "tsMs": now_unix_ms(),
            "source": source,
            "runningBefore": snapshot_before.running,
            "localThreadIdBefore": snapshot_before.local_thread_id,
            "turnIdBefore": snapshot_before.turn_id,
        }),
    );

    let start_result = state
        .runtime
        .start(
            app.clone(),
            bridge_process::HelperStartPayload {
                convex_url: config.convex_url,
                actor: config.actor,
                session_id: config.session_id,
                disabled_tools: config.disabled_tools,
                model: config.model,
                cwd: config.cwd,
                delta_throttle_ms: config.delta_throttle_ms,
                save_stream_deltas: config.save_stream_deltas,
            },
        )
        .await;

    match &start_result {
        Ok(()) => {
            let _ = app.emit(
                "codex:global_message",
                serde_json::json!({
                    "kind": "bridge/start_trace",
                    "phase": "result",
                    "traceId": trace_id,
                    "tsMs": now_unix_ms(),
                    "source": source,
                    "status": "ok",
                }),
            );
        }
        Err(message) => {
            let _ = app.emit(
                "codex:global_message",
                serde_json::json!({
                    "kind": "bridge/start_trace",
                    "phase": "result",
                    "traceId": trace_id,
                    "tsMs": now_unix_ms(),
                    "source": source,
                    "status": "error",
                    "message": message,
                }),
            );
        }
    }

    start_result
}

#[tauri::command]
async fn open_thread(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: OpenThreadConfig,
) -> Result<(), String> {
    state
        .runtime
        .forward_tauri_json_command(
            app,
            "open_thread",
            json!({
                "strategy": config.strategy,
                "threadId": config.thread_id,
                "model": config.model,
                "cwd": config.cwd,
                "dynamicTools": config.dynamic_tools,
            }),
        )
        .await
}

#[tauri::command]
async fn send_user_turn(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    text: String,
) -> Result<(), String> {
    state
        .runtime
        .forward_tauri_json_command(app, "send_user_turn", json!({ "text": text }))
        .await
}

#[tauri::command]
async fn interrupt_turn(app: tauri::AppHandle, state: State<'_, AppBridgeState>) -> Result<(), String> {
    state
        .runtime
        .forward_tauri_json_command(app, "interrupt_turn", json!({}))
        .await
}

#[tauri::command]
async fn respond_command_approval(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "respond_command_approval", config).await
}

#[tauri::command]
async fn respond_file_change_approval(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "respond_file_change_approval", config).await
}

#[tauri::command]
async fn respond_tool_user_input(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "respond_tool_user_input", config).await
}

#[tauri::command]
async fn read_account(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "read_account", config).await
}

#[tauri::command]
async fn login_account(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "login_account", config).await
}

#[tauri::command]
async fn cancel_account_login(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "cancel_account_login", config).await
}

#[tauri::command]
async fn logout_account(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
) -> Result<(), String> {
    state
        .runtime
        .forward_tauri_json_command(app, "logout_account", json!({}))
        .await
}

#[tauri::command]
async fn read_account_rate_limits(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
) -> Result<(), String> {
    state
        .runtime
        .forward_tauri_json_command(app, "read_account_rate_limits", json!({}))
        .await
}

#[tauri::command]
async fn respond_chatgpt_auth_tokens_refresh(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "respond_chatgpt_auth_tokens_refresh", config).await
}

#[tauri::command]
async fn stop_bridge(app: tauri::AppHandle, state: State<'_, AppBridgeState>) -> Result<(), String> {
    state.runtime.stop(app).await
}

#[tauri::command]
async fn get_bridge_state(state: State<'_, AppBridgeState>) -> Result<bridge_process::BridgeStateSnapshot, String> {
    Ok(state.runtime.snapshot().await)
}

#[tauri::command]
async fn set_disabled_tools(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: serde_json::Value,
) -> Result<(), String> {
    state.runtime.forward_tauri_json_command(app, "set_disabled_tools", config).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    debug_assert_eq!(BRIDGE_COMMANDS.len(), 16);
    debug_assert!(!HELPER_COMMANDS.is_empty());
    debug_assert!(!HELPER_FORWARD_TAURI_COMMANDS.is_empty());
    let app = tauri::Builder::default()
        .manage(AppBridgeState {
            runtime: BridgeRuntime::default(),
        })
        .invoke_handler(bridge_generate_handler!())
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app, event| match event {
        RunEvent::WindowEvent {
            event: WindowEvent::CloseRequested { .. },
            ..
        }
        | RunEvent::ExitRequested { .. }
        | RunEvent::Exit => {
            tauri::async_runtime::block_on(async {
                let app_handle = app.clone();
                let state_handle = app_handle.clone();
                let state = state_handle.state::<AppBridgeState>();
                let _ = state.runtime.stop(app_handle).await;
            });
        }
        _ => {}
    });
}

fn main() {
    run();
}
