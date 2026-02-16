// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: bridge/command-contract.json
import type { v2 } from "@zakstam/codex-local-component/protocol";

type CommandExecutionApprovalDecision = v2.CommandExecutionApprovalDecision;
type FileChangeApprovalDecision = v2.FileChangeApprovalDecision;
type ToolRequestUserInputAnswer = v2.ToolRequestUserInputAnswer;
type LoginAccountParams = v2.LoginAccountParams;

export type ActorContext = { userId?: string };
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

export const HELPER_COMMAND_TYPES = [
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
] as const;

const helperCommandTypeSet = new Set<string>(HELPER_COMMAND_TYPES);

export type HelperCommand =
  | { type: "start"; payload: StartPayload }
  | { type: "send_turn"; payload: { text: string } }
  | { type: "interrupt" }
  | { type: "respond_command_approval"; payload: { requestId: string | number; decision: CommandExecutionApprovalDecision } }
  | { type: "respond_file_change_approval"; payload: { requestId: string | number; decision: FileChangeApprovalDecision } }
  | { type: "respond_tool_user_input"; payload: { requestId: string | number; answers: Record<string, ToolRequestUserInputAnswer> } }
  | { type: "account_read"; payload: { refreshToken?: boolean } }
  | { type: "account_login_start"; payload: { params: LoginAccountParams } }
  | { type: "account_login_cancel"; payload: { loginId: string } }
  | { type: "account_logout"; payload: Record<string, never> }
  | { type: "account_rate_limits_read"; payload: Record<string, never> }
  | { type: "respond_chatgpt_auth_tokens_refresh"; payload: { requestId: string | number; accessToken: string; chatgptAccountId: string; chatgptPlanType?: string | null } }
  | { type: "set_disabled_tools"; payload: { tools: string[] } }
  | { type: "stop" }
  | { type: "status" }
;

export function parseHelperCommand(line: string): HelperCommand {
  const parsed = JSON.parse(line) as { type?: unknown; payload?: unknown };
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Helper command must be an object.");
  }
  if (typeof parsed.type !== "string" || !helperCommandTypeSet.has(parsed.type)) {
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
