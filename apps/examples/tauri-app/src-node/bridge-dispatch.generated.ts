// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: bridge/command-contract.json

export const HELPER_ACK_BY_TYPE = {
  "start": false,
  "send_turn": true,
  "interrupt": true,
  "respond_command_approval": true,
  "respond_file_change_approval": true,
  "respond_tool_user_input": true,
  "account_read": true,
  "account_login_start": true,
  "account_login_cancel": true,
  "account_logout": true,
  "account_rate_limits_read": true,
  "respond_chatgpt_auth_tokens_refresh": true,
  "set_disabled_tools": true,
  "stop": false,
  "status": true,
} as const;

export type HelperCommandType = keyof typeof HELPER_ACK_BY_TYPE;

export const TAURI_TO_HELPER_COMMAND = {
  "start_bridge": "start",
  "send_user_turn": "send_turn",
  "interrupt_turn": "interrupt",
  "respond_command_approval": "respond_command_approval",
  "respond_file_change_approval": "respond_file_change_approval",
  "respond_tool_user_input": "respond_tool_user_input",
  "read_account": "account_read",
  "login_account": "account_login_start",
  "cancel_account_login": "account_login_cancel",
  "logout_account": "account_logout",
  "read_account_rate_limits": "account_rate_limits_read",
  "respond_chatgpt_auth_tokens_refresh": "respond_chatgpt_auth_tokens_refresh",
  "set_disabled_tools": "set_disabled_tools",
  "stop_bridge": "stop",
} as const;

export function helperCommandForTauriCommand(tauriCommand: string): HelperCommandType | null {
  return (TAURI_TO_HELPER_COMMAND as Record<string, HelperCommandType>)[tauriCommand] ?? null;
}
