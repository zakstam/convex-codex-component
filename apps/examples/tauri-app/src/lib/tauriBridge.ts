import { invoke } from "@tauri-apps/api/core";

export type ActorContext = {
  tenantId: string;
  userId: string;
  deviceId: string;
};

export type BridgeState = {
  running: boolean;
  localThreadId: string | null;
  turnId: string | null;
  lastError: string | null;
  runtimeThreadId?: string | null;
  pendingServerRequestCount?: number | null;
};

export type CommandApprovalDecision =
  | "accept"
  | "acceptForSession"
  | "decline"
  | "cancel";

export type ToolUserInputAnswer = { answers: string[] };

export async function startBridge(config: {
  convexUrl: string;
  actor: ActorContext;
  sessionId: string;
  model?: string;
  cwd?: string;
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

export async function stopBridge() {
  return await invoke("stop_bridge");
}

export async function getBridgeState(): Promise<BridgeState> {
  return await invoke("get_bridge_state");
}
