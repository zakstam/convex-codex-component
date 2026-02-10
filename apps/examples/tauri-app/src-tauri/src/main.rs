mod bridge_process;

use bridge_process::{AppBridgeState, BridgeRuntime};
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartBridgeConfig {
    convex_url: String,
    actor: bridge_process::ActorContext,
    session_id: String,
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
    id_token: String,
    access_token: String,
}

#[tauri::command]
async fn start_bridge(
    app: tauri::AppHandle,
    state: State<'_, AppBridgeState>,
    config: StartBridgeConfig,
) -> Result<(), String> {
    state
        .runtime
        .start(
            app,
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
        .await
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
            config.id_token,
            config.access_token,
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
    tauri::Builder::default()
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
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
