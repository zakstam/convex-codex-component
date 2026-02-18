import type { LoginAccountParams as ProtocolLoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";

// Re-export all shared bridge types, constants, and functions
export type {
  ActorContext,
  BridgeClient,
  BridgeState,
  CommandApprovalDecision,
  HelperCommand,
  HelperCommandType,
  LoginAccountParams,
  StartBridgeConfig,
  StartPayload,
  ToolUserInputAnswer,
} from "./bridge.js";

export {
  HELPER_ACK_BY_TYPE,
  HELPER_COMMAND_TYPES,
  parseHelperCommand,
} from "./bridge.js";

// Backward compat: TauriBridgeClient is now an alias for BridgeClient
export type { BridgeClient as TauriBridgeClient } from "./bridge.js";

import {
  HELPER_COMMAND_TYPES as _HELPER_COMMAND_TYPES,
  type BridgeClient,
  type BridgeState,
  type CommandApprovalDecision,
  type HelperCommandType,
  type StartBridgeConfig,
  type ToolUserInputAnswer,
} from "./bridge.js";

// ── Tauri-specific code ──────────────────────────────────────────

type TauriBridgeCommandDefinition = {
  id: string;
  helperType?: HelperCommandType;
  tauriCommand?: string;
  permission?: boolean;
  ack?: boolean;
};

export const TAURI_BRIDGE_COMMANDS: ReadonlyArray<TauriBridgeCommandDefinition> = [
  { id: "start_bridge", tauriCommand: "start_bridge", helperType: "start", permission: true, ack: false },
  { id: "send_user_turn", tauriCommand: "send_user_turn", helperType: "send_turn", permission: true, ack: true },
  { id: "interrupt_turn", tauriCommand: "interrupt_turn", helperType: "interrupt", permission: true, ack: true },
  {
    id: "respond_command_approval",
    tauriCommand: "respond_command_approval",
    helperType: "respond_command_approval",
    permission: true,
    ack: true,
  },
  {
    id: "respond_file_change_approval",
    tauriCommand: "respond_file_change_approval",
    helperType: "respond_file_change_approval",
    permission: true,
    ack: true,
  },
  {
    id: "respond_tool_user_input",
    tauriCommand: "respond_tool_user_input",
    helperType: "respond_tool_user_input",
    permission: true,
    ack: true,
  },
  { id: "read_account", tauriCommand: "read_account", helperType: "account_read", permission: true, ack: true },
  {
    id: "login_account",
    tauriCommand: "login_account",
    helperType: "account_login_start",
    permission: true,
    ack: true,
  },
  {
    id: "cancel_account_login",
    tauriCommand: "cancel_account_login",
    helperType: "account_login_cancel",
    permission: true,
    ack: true,
  },
  { id: "logout_account", tauriCommand: "logout_account", helperType: "account_logout", permission: true, ack: true },
  {
    id: "read_account_rate_limits",
    tauriCommand: "read_account_rate_limits",
    helperType: "account_rate_limits_read",
    permission: true,
    ack: true,
  },
  {
    id: "respond_chatgpt_auth_tokens_refresh",
    tauriCommand: "respond_chatgpt_auth_tokens_refresh",
    helperType: "respond_chatgpt_auth_tokens_refresh",
    permission: true,
    ack: true,
  },
  {
    id: "set_disabled_tools",
    tauriCommand: "set_disabled_tools",
    helperType: "set_disabled_tools",
    permission: true,
    ack: true,
  },
  { id: "stop_bridge", tauriCommand: "stop_bridge", helperType: "stop", permission: true, ack: false },
  { id: "get_bridge_state", tauriCommand: "get_bridge_state", permission: true },
  { id: "helper_status", helperType: "status", ack: true },
];

const TAURI_TO_HELPER_COMMAND: Readonly<Record<string, HelperCommandType>> = Object.freeze(
  TAURI_BRIDGE_COMMANDS.reduce<Record<string, HelperCommandType>>((acc, command) => {
    if (typeof command.tauriCommand === "string" && typeof command.helperType === "string") {
      acc[command.tauriCommand] = command.helperType;
    }
    return acc;
  }, {}),
);

export function helperCommandForTauriCommand(tauriCommand: string): HelperCommandType | null {
  return TAURI_TO_HELPER_COMMAND[tauriCommand] ?? null;
}

export type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

export function createTauriBridgeClient(invoke: TauriInvoke): BridgeClient {
  return {
    lifecycle: {
      start(config: StartBridgeConfig): Promise<unknown> {
        return invoke("start_bridge", { config });
      },
      stop(): Promise<unknown> {
        return invoke("stop_bridge");
      },
      getState(): Promise<BridgeState> {
        return invoke("get_bridge_state");
      },
    },
    turns: {
      send(text: string): Promise<unknown> {
        return invoke("send_user_turn", { text });
      },
      interrupt(): Promise<unknown> {
        return invoke("interrupt_turn");
      },
    },
    approvals: {
      respondCommand(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown> {
        return invoke("respond_command_approval", { config });
      },
      respondFileChange(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown> {
        return invoke("respond_file_change_approval", { config });
      },
      respondToolInput(config: { requestId: string | number; answers: Record<string, ToolUserInputAnswer> }): Promise<unknown> {
        return invoke("respond_tool_user_input", { config });
      },
    },
    account: {
      read(config?: { refreshToken?: boolean }): Promise<unknown> {
        return invoke("read_account", { config: config ?? {} });
      },
      login(config: { params: ProtocolLoginAccountParams }): Promise<unknown> {
        return invoke("login_account", { config });
      },
      cancelLogin(config: { loginId: string }): Promise<unknown> {
        return invoke("cancel_account_login", { config });
      },
      logout(): Promise<unknown> {
        return invoke("logout_account");
      },
      readRateLimits(): Promise<unknown> {
        return invoke("read_account_rate_limits");
      },
      respondChatgptAuthTokensRefresh(config: {
        requestId: string | number;
        accessToken: string;
        chatgptAccountId: string;
        chatgptPlanType?: string | null;
      }): Promise<unknown> {
        return invoke("respond_chatgpt_auth_tokens_refresh", { config });
      },
    },
    tools: {
      setDisabled(config: { tools: string[] }): Promise<unknown> {
        return invoke("set_disabled_tools", { config });
      },
    },
  };
}

function toKebabCase(value: string): string {
  return value.replaceAll("_", "-");
}

export type TauriGeneratedPermissionFile = {
  filename: string;
  contents: string;
};

export type TauriGeneratedArtifacts = {
  rustContractSource: string;
  rustDispatchSource: string;
  rustInvokeHandlersSource: string;
  permissionFiles: TauriGeneratedPermissionFile[];
};

export function generateTauriArtifacts(): TauriGeneratedArtifacts {
  const tauriCommands = TAURI_BRIDGE_COMMANDS.filter(
    (command): command is TauriBridgeCommandDefinition & { tauriCommand: string } =>
      typeof command.tauriCommand === "string",
  );

  const helperCommandTypes = _HELPER_COMMAND_TYPES;

  const rustContractSource = `${[
    "// AUTO-GENERATED FILE. DO NOT EDIT.",
    "// Source: @zakstam/codex-local-component/host/tauri",
    "pub const BRIDGE_COMMANDS: &[&str] = &[",
    ...tauriCommands.map((command) => `    \"${command.tauriCommand}\",`),
    "];",
    "",
    "pub const HELPER_COMMANDS: &[&str] = &[",
    ...helperCommandTypes.map((command) => `    \"${command}\",`),
    "];",
    "",
  ].join("\n")}`;

  const rustDispatchSource = `${[
    "// AUTO-GENERATED FILE. DO NOT EDIT.",
    "// Source: @zakstam/codex-local-component/host/tauri",
    "",
    "pub const HELPER_FORWARD_TAURI_COMMANDS: &[&str] = &[",
    ...tauriCommands
      .filter((command) => typeof command.helperType === "string")
      .map((command) => `    \"${command.tauriCommand}\",`),
    "];",
    "",
    "pub fn helper_command_for_tauri_command(tauri_command: &str) -> Option<&'static str> {",
    "    match tauri_command {",
    ...tauriCommands
      .filter((command) => typeof command.helperType === "string")
      .map((command) => `        \"${command.tauriCommand}\" => Some(\"${command.helperType}\"),`),
    "        _ => None,",
    "    }",
    "}",
    "",
  ].join("\n")}`;

  const rustInvokeHandlersSource = `${[
    "// AUTO-GENERATED FILE. DO NOT EDIT.",
    "// Source: @zakstam/codex-local-component/host/tauri",
    "",
    "macro_rules! bridge_generate_handler {",
    "    () => {",
    "        tauri::generate_handler![",
    ...tauriCommands.map((command) => `            ${command.tauriCommand},`),
    "        ]",
    "    };",
    "}",
    "",
  ].join("\n")}`;

  const permissionFiles = tauriCommands
    .filter((command) => command.permission === true)
    .map((command) => {
      const id = toKebabCase(command.tauriCommand);
      return {
        filename: `${command.tauriCommand}.toml`,
        contents: `${[
          "# Automatically generated - DO NOT EDIT!",
          "",
          "[[permission]]",
          `identifier = \"allow-${id}\"`,
          `description = \"Enables the ${command.tauriCommand} command without a pre-configured scope.\"`,
          `commands.allow = [\"${command.tauriCommand}\"]`,
          "",
          "[[permission]]",
          `identifier = \"deny-${id}\"`,
          `description = \"Denies the ${command.tauriCommand} command without a pre-configured scope.\"`,
          `commands.deny = [\"${command.tauriCommand}\"]`,
          "",
        ].join("\n")}`,
      };
    });

  return {
    rustContractSource,
    rustDispatchSource,
    rustInvokeHandlersSource,
    permissionFiles,
  };
}
