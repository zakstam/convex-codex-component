import { invoke } from "@tauri-apps/api/core";

export type ActorContext = {
  userId?: string;
};

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

export type CommandApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export type ToolUserInputAnswer = { answers: string[] };
export type LoginAccountParams =
  | { type: "apiKey"; apiKey: string }
  | { type: "chatgpt" }
  | {
      type: "chatgptAuthTokens";
      accessToken: string;
      chatgptAccountId: string;
      chatgptPlanType?: string | null;
    };

export async function startBridge(config: {
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
}) {
  return await invoke("start_bridge", { config });
}

export async function sendUserTurn(text: string) {
  return await invoke("send_user_turn", { text });
}

export async function interruptTurn() {
  return await invoke("interrupt_turn");
}

export async function respondCommandApproval(config: {
  requestId: string | number;
  decision: CommandApprovalDecision;
}) {
  return await invoke("respond_command_approval", { config });
}

export async function respondFileChangeApproval(config: {
  requestId: string | number;
  decision: CommandApprovalDecision;
}) {
  return await invoke("respond_file_change_approval", { config });
}

export async function respondToolUserInput(config: {
  requestId: string | number;
  answers: Record<string, ToolUserInputAnswer>;
}) {
  return await invoke("respond_tool_user_input", { config });
}

export async function readAccount(config?: { refreshToken?: boolean }) {
  return await invoke("read_account", { config: config ?? {} });
}

export async function loginAccount(config: { params: LoginAccountParams }) {
  return await invoke("login_account", { config });
}

export async function cancelAccountLogin(config: { loginId: string }) {
  return await invoke("cancel_account_login", { config });
}

export async function logoutAccount() {
  return await invoke("logout_account");
}

export async function readAccountRateLimits() {
  return await invoke("read_account_rate_limits");
}

export async function respondChatgptAuthTokensRefresh(config: {
  requestId: string | number;
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType?: string | null;
}) {
  return await invoke("respond_chatgpt_auth_tokens_refresh", { config });
}

export async function setDisabledTools(config: { tools: string[] }) {
  return await invoke("set_disabled_tools", { config });
}

export async function stopBridge() {
  return await invoke("stop_bridge");
}

export async function getBridgeState(): Promise<BridgeState> {
  return await invoke("get_bridge_state");
}
