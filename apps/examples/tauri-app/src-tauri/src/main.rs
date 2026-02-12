mod bridge_process;

use bridge_process::{AppBridgeState, BridgeRuntime};
use serde::Deserialize;
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
    delta_throttle_ms: Option<u64>,
    save_stream_deltas: Option<bool>,
    thread_strategy: Option<String>,
    runtime_thread_id: Option<String>,
    external_thread_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RespondApprovalConfig {
    request_id: serde_json::Value,
    decision: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RespondToolUserInputConfig {
    request_id: serde_json::Value,
    answers: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadAccountConfig {
    refresh_token: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginAccountConfig {
    params: serde_json::Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelAccountLoginConfig {
    login_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RespondChatgptAuthTokensRefreshConfig {
    request_id: serde_json::Value,
    access_token: String,
    chatgpt_account_id: String,
    chatgpt_plan_type: Option<String>,
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
            "runtimeThreadIdBefore": snapshot_before.runtime_thread_id,
            "localThreadIdBefore": snapshot_before.local_thread_id,
            "turnIdBefore": snapshot_before.turn_id,
            "threadStrategy": config.thread_strategy,
            "runtimeThreadIdArg": config.runtime_thread_id,
            "externalThreadIdArg": config.external_thread_id,
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
                model: config.model,
                cwd: config.cwd,
                delta_throttle_ms: config.delta_throttle_ms,
                save_stream_deltas: config.save_stream_deltas,
                thread_strategy: config.thread_strategy,
                runtime_thread_id: config.runtime_thread_id,
                external_thread_id: config.external_thread_id,
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
async fn send_user_turn(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    text: String,
) -> Result<(), String> {
    state.runtime.send_turn(app, text).await
}

#[tauri::command]
async fn interrupt_turn(app: tauri::AppHandle, state: State<'_, AppBridgeState>) -> Result<(), String> {
    state.runtime.interrupt(app).await
}

#[tauri::command]
async fn respond_command_approval(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: RespondApprovalConfig,
) -> Result<(), String> {
    state
        .runtime
        .respond_command_approval(app, config.request_id, config.decision)
        .await
}

#[tauri::command]
async fn respond_file_change_approval(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: RespondApprovalConfig,
) -> Result<(), String> {
    state
        .runtime
        .respond_file_change_approval(app, config.request_id, config.decision)
        .await
}

#[tauri::command]
async fn respond_tool_user_input(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: RespondToolUserInputConfig,
) -> Result<(), String> {
    state
        .runtime
        .respond_tool_user_input(app, config.request_id, config.answers)
        .await
}

#[tauri::command]
async fn read_account(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: ReadAccountConfig,
) -> Result<(), String> {
    state.runtime.read_account(app, config.refresh_token).await
}

#[tauri::command]
async fn login_account(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: LoginAccountConfig,
) -> Result<(), String> {
    state.runtime.login_account(app, config.params).await
}

#[tauri::command]
async fn cancel_account_login(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: CancelAccountLoginConfig,
) -> Result<(), String> {
    state
        .runtime
        .cancel_account_login(app, config.login_id)
        .await
}

#[tauri::command]
async fn logout_account(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
) -> Result<(), String> {
    state.runtime.logout_account(app).await
}

#[tauri::command]
async fn read_account_rate_limits(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
) -> Result<(), String> {
    state.runtime.read_account_rate_limits(app).await
}

#[tauri::command]
async fn respond_chatgpt_auth_tokens_refresh(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: RespondChatgptAuthTokensRefreshConfig,
) -> Result<(), String> {
    state
        .runtime
        .respond_chatgpt_auth_tokens_refresh(
            app,
            config.request_id,
            config.access_token,
            config.chatgpt_account_id,
            config.chatgpt_plan_type,
        )
        .await
}

#[tauri::command]
async fn stop_bridge(app: tauri::AppHandle, state: State<'_, AppBridgeState>) -> Result<(), String> {
    state.runtime.stop(app).await
}

#[tauri::command]
async fn get_bridge_state(state: State<'_, AppBridgeState>) -> Result<bridge_process::BridgeStateSnapshot, String> {
    Ok(state.runtime.snapshot().await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppBridgeState {
            runtime: BridgeRuntime::default(),
        })
        .invoke_handler(tauri::generate_handler![
            start_bridge,
            send_user_turn,
            interrupt_turn,
            respond_command_approval,
            respond_file_change_approval,
            respond_tool_user_input,
            read_account,
            login_account,
            cancel_account_login,
            logout_account,
            read_account_rate_limits,
            respond_chatgpt_auth_tokens_refresh,
            stop_bridge,
            get_bridge_state
        ])
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
