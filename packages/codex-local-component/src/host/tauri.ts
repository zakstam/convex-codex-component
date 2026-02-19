import type { CommandExecutionApprovalDecision } from "../protocol/schemas/v2/CommandExecutionApprovalDecision.js";
import type { FileChangeApprovalDecision } from "../protocol/schemas/v2/FileChangeApprovalDecision.js";
import type { LoginAccountParams as ProtocolLoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";
import type { ToolRequestUserInputAnswer } from "../protocol/schemas/v2/ToolRequestUserInputAnswer.js";

export type { LoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";

export type ActorContext = { userId?: string };

export type BridgeState = {
  running: boolean;
  localThreadId: string | null;
  turnId: string | null;
  lastErrorCode?: string | null;
  lastError: string | null;
  disabledTools?: string[];
  pendingServerRequestCount?: number | null;
  ingestEnqueuedEventCount?: number | null;
  ingestSkippedEventCount?: number | null;
  ingestEnqueuedByKind?: Array<{ kind: string; count: number }> | null;
  ingestSkippedByKind?: Array<{ kind: string; count: number }> | null;
};

export type CommandApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
export type ToolUserInputAnswer = { answers: string[] };

export type StartBridgeConfig = {
  convexUrl: string;
  actor: ActorContext;
  sessionId: string;
  startSource?: string;
  model?: string;
  cwd?: string;
  disabledTools?: string[];
  deltaThrottleMs?: number;
  saveStreamDeltas?: boolean;
  threadStrategy?: "start" | "resume" | "fork";
  threadId?: string;
};

export type StartPayload = {
  convexUrl: string;
  actor: ActorContext;
  sessionId: string;
  model?: string;
  cwd?: string;
  disabledTools?: string[];
  deltaThrottleMs?: number;
  saveStreamDeltas?: boolean;
  threadStrategy?: "start" | "resume" | "fork";
  threadId?: string;
};

export type HelperCommandType =
  | "start"
  | "send_turn"
  | "interrupt"
  | "respond_command_approval"
  | "respond_file_change_approval"
  | "respond_tool_user_input"
  | "account_read"
  | "account_login_start"
  | "account_login_cancel"
  | "account_logout"
  | "account_rate_limits_read"
  | "respond_chatgpt_auth_tokens_refresh"
  | "set_disabled_tools"
  | "stop"
  | "status";

export type HelperCommand =
  | { type: "start"; payload: StartPayload }
  | { type: "send_turn"; payload: { text: string } }
  | { type: "interrupt" }
  | { type: "respond_command_approval"; payload: { requestId: string | number; decision: CommandExecutionApprovalDecision } }
  | { type: "respond_file_change_approval"; payload: { requestId: string | number; decision: FileChangeApprovalDecision } }
  | { type: "respond_tool_user_input"; payload: { requestId: string | number; answers: Record<string, ToolRequestUserInputAnswer> } }
  | { type: "account_read"; payload: { refreshToken?: boolean } }
  | { type: "account_login_start"; payload: { params: ProtocolLoginAccountParams } }
  | { type: "account_login_cancel"; payload: { loginId: string } }
  | { type: "account_logout"; payload: Record<string, never> }
  | { type: "account_rate_limits_read"; payload: Record<string, never> }
  | {
      type: "respond_chatgpt_auth_tokens_refresh";
      payload: {
        requestId: string | number;
        accessToken: string;
        chatgptAccountId: string;
        chatgptPlanType?: string | null;
      };
    }
  | { type: "set_disabled_tools"; payload: { tools: string[] } }
  | { type: "stop" }
  | { type: "status" };

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

export const HELPER_COMMAND_TYPES = TAURI_BRIDGE_COMMANDS
  .map((command) => command.helperType)
  .filter((helperType): helperType is HelperCommandType => typeof helperType === "string");

export const HELPER_ACK_BY_TYPE: Readonly<Record<HelperCommandType, boolean>> = Object.freeze({
  start: false,
  send_turn: true,
  interrupt: true,
  respond_command_approval: true,
  respond_file_change_approval: true,
  respond_tool_user_input: true,
  account_read: true,
  account_login_start: true,
  account_login_cancel: true,
  account_logout: true,
  account_rate_limits_read: true,
  respond_chatgpt_auth_tokens_refresh: true,
  set_disabled_tools: true,
  stop: false,
  status: true,
});

const HELPER_COMMAND_TYPE_SET = new Set<HelperCommandType>(HELPER_COMMAND_TYPES);

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

export function parseHelperCommand(line: string): HelperCommand {
  const parsed = JSON.parse(line) as { type?: unknown; payload?: unknown };
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Helper command must be an object.");
  }
  if (typeof parsed.type !== "string" || !HELPER_COMMAND_TYPE_SET.has(parsed.type as HelperCommandType)) {
    throw new Error(`Unsupported helper command: ${String(parsed.type)}`);
  }
  if (parsed.type === "interrupt" || parsed.type === "stop" || parsed.type === "status") {
    return { type: parsed.type } as HelperCommand;
  }
  if (!("payload" in parsed)) {
    throw new Error(`Missing payload for helper command: ${parsed.type}`);
  }
  return parsed as HelperCommand;
}

export type TauriInvoke = <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;

export type TauriBridgeClient = {
  lifecycle: {
    start(config: StartBridgeConfig): Promise<unknown>;
    stop(): Promise<unknown>;
    getState(): Promise<BridgeState>;
  };
  turns: {
    send(text: string): Promise<unknown>;
    interrupt(): Promise<unknown>;
  };
  approvals: {
    respondCommand(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown>;
    respondFileChange(config: { requestId: string | number; decision: CommandApprovalDecision }): Promise<unknown>;
    respondToolInput(config: { requestId: string | number; answers: Record<string, ToolUserInputAnswer> }): Promise<unknown>;
  };
  account: {
    read(config?: { refreshToken?: boolean }): Promise<unknown>;
    login(config: { params: ProtocolLoginAccountParams }): Promise<unknown>;
    cancelLogin(config: { loginId: string }): Promise<unknown>;
    logout(): Promise<unknown>;
    readRateLimits(): Promise<unknown>;
    respondChatgptAuthTokensRefresh(config: {
      requestId: string | number;
      accessToken: string;
      chatgptAccountId: string;
      chatgptPlanType?: string | null;
    }): Promise<unknown>;
  };
  tools: {
    setDisabled(config: { tools: string[] }): Promise<unknown>;
  };
};

export function createTauriBridgeClient(invoke: TauriInvoke): TauriBridgeClient {
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
  const helperCommands = HELPER_COMMAND_TYPES;

  const rustContractSource = `${[
    "// AUTO-GENERATED FILE. DO NOT EDIT.",
    "// Source: @zakstam/codex-local-component/host/tauri",
    "pub const BRIDGE_COMMANDS: &[&str] = &[",
    ...tauriCommands.map((command) => `    \"${command.tauriCommand}\",`),
    "];",
    "",
    "pub const HELPER_COMMANDS: &[&str] = &[",
    ...helperCommands.map((command) => `    \"${command}\",`),
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
