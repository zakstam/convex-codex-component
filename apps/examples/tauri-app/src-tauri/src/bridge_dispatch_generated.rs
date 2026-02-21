// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: @zakstam/codex-local-component/host/tauri

pub const HELPER_FORWARD_TAURI_COMMANDS: &[&str] = &[
    "start_bridge",
    "open_thread",
    "refresh_local_threads",
    "send_user_turn",
    "interrupt_turn",
    "respond_command_approval",
    "respond_file_change_approval",
    "respond_tool_user_input",
    "read_account",
    "login_account",
    "cancel_account_login",
    "logout_account",
    "read_account_rate_limits",
    "respond_chatgpt_auth_tokens_refresh",
    "set_disabled_tools",
    "stop_bridge",
];

pub fn helper_command_for_tauri_command(tauri_command: &str) -> Option<&'static str> {
    match tauri_command {
        "start_bridge" => Some("start"),
        "open_thread" => Some("open_thread"),
        "refresh_local_threads" => Some("refresh_local_threads"),
        "send_user_turn" => Some("send_turn"),
        "interrupt_turn" => Some("interrupt"),
        "respond_command_approval" => Some("respond_command_approval"),
        "respond_file_change_approval" => Some("respond_file_change_approval"),
        "respond_tool_user_input" => Some("respond_tool_user_input"),
        "read_account" => Some("account_read"),
        "login_account" => Some("account_login_start"),
        "cancel_account_login" => Some("account_login_cancel"),
        "logout_account" => Some("account_logout"),
        "read_account_rate_limits" => Some("account_rate_limits_read"),
        "respond_chatgpt_auth_tokens_refresh" => Some("respond_chatgpt_auth_tokens_refresh"),
        "set_disabled_tools" => Some("set_disabled_tools"),
        "stop_bridge" => Some("stop"),
        _ => None,
    }
}
