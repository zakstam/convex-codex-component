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
  runtimeThreadId?: string | null;
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
  runtimeThreadId?: string;
  externalThreadId?: string;
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
  runtimeThreadId?: string;
  externalThreadId?: string;
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

export type BridgeClient = {
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

export const HELPER_COMMAND_TYPES: ReadonlyArray<HelperCommandType> = [
  "start",
  "send_turn",
  "interrupt",
  "respond_command_approval",
  "respond_file_change_approval",
  "respond_tool_user_input",
  "account_read",
  "account_login_start",
  "account_login_cancel",
  "account_logout",
  "account_rate_limits_read",
  "respond_chatgpt_auth_tokens_refresh",
  "set_disabled_tools",
  "stop",
  "status",
];

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
