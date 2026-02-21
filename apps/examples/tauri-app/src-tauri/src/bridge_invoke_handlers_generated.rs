// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: @zakstam/codex-local-component/host/tauri

macro_rules! bridge_generate_handler {
    () => {
        tauri::generate_handler![
            start_bridge,
            open_thread,
            refresh_local_threads,
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
            set_disabled_tools,
            stop_bridge,
            get_bridge_state,
        ]
    };
}
