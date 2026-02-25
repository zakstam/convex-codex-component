import type { HelperCommand } from "@zakstam/codex-runtime-bridge-tauri";

type TauriReproCaptureCommand = {
  phase?: string;
  command?: string;
  args?: unknown;
};

type TauriReproArtifactV1 = {
  version?: string;
  commands?: TauriReproCaptureCommand[];
  diagnostics?: { errorClasses?: string[] };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function mapInvokeToHelper(command: TauriReproCaptureCommand): HelperCommand | null {
  const tauriCommand = command.command;
  if (typeof tauriCommand !== "string") {
    return null;
  }
  const args = asRecord(command.args);
  const config = asRecord(args?.config);
  switch (tauriCommand) {
    case "start_bridge":
      if (!config) return null;
      return { type: "start", payload: config as never };
    case "open_thread":
      if (!config) return null;
      return { type: "open_thread", payload: config as never };
    case "refresh_local_threads":
      return { type: "refresh_local_threads", payload: {} };
    case "send_user_turn": {
      const text = typeof args?.text === "string" ? args.text : null;
      if (!text) return null;
      return { type: "send_turn", payload: { text } };
    }
    case "interrupt_turn":
      return { type: "interrupt" };
    case "respond_command_approval":
      if (!config) return null;
      return { type: "respond_command_approval", payload: config as never };
    case "respond_file_change_approval":
      if (!config) return null;
      return { type: "respond_file_change_approval", payload: config as never };
    case "respond_tool_user_input":
      if (!config) return null;
      return { type: "respond_tool_user_input", payload: config as never };
    case "read_account":
      return { type: "account_read", payload: (config ?? {}) as never };
    case "login_account":
      if (!config) return null;
      return { type: "account_login_start", payload: config as never };
    case "cancel_account_login":
      if (!config) return null;
      return { type: "account_login_cancel", payload: config as never };
    case "logout_account":
      return { type: "account_logout", payload: {} };
    case "read_account_rate_limits":
      return { type: "account_rate_limits_read", payload: {} };
    case "respond_chatgpt_auth_tokens_refresh":
      if (!config) return null;
      return {
        type: "respond_chatgpt_auth_tokens_refresh",
        payload: config as never,
      };
    case "set_disabled_tools":
      if (!config) return null;
      return { type: "set_disabled_tools", payload: config as never };
    case "stop_bridge":
      return { type: "stop" };
    case "get_bridge_state":
      return { type: "status" };
    default:
      return null;
  }
}

export function parseReplayArtifact(
  raw: unknown,
): { commands: HelperCommand[]; expectedErrorClasses: string[] } {
  const record = asRecord(raw);
  if (!record) {
    throw new Error("Replay artifact must be an object.");
  }
  const version = record.version;
  if (version !== "tauri-repro-v1") {
    throw new Error(`Unsupported replay artifact version: ${String(version)}`);
  }
  const commandsRaw = Array.isArray(record.commands) ? record.commands : [];
  const commands = commandsRaw
    .map((command) => command as TauriReproCaptureCommand)
    .filter((command) => command.phase === "invoke_start")
    .map((command) => mapInvokeToHelper(command))
    .filter((command): command is HelperCommand => command !== null);
  if (commands.length === 0) {
    throw new Error("Replay artifact did not contain any replayable helper commands.");
  }
  const diagnostics = asRecord(record.diagnostics) as TauriReproArtifactV1["diagnostics"] | null;
  const expectedErrorClasses = Array.isArray(diagnostics?.errorClasses)
    ? diagnostics.errorClasses.filter((entry): entry is string => typeof entry === "string")
    : [];
  return { commands, expectedErrorClasses };
}
