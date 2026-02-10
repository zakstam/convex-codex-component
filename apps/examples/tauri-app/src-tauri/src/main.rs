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
            stop_bridge,
            get_bridge_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn main() {
    run();
}
