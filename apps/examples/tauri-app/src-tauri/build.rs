fn main() {
  let app_manifest = tauri_build::AppManifest::new().commands(&[
    "start_bridge",
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
    "stop_bridge",
    "get_bridge_state",
    "set_disabled_tools",
  ]);

  tauri_build::try_build(tauri_build::Attributes::new().app_manifest(app_manifest))
    .expect("error while running tauri build script");
}
