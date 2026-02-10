import { invoke } from "@tauri-apps/api/core";

export type ActorContext = {
  tenantId: string;
  userId: string;
  deviceId: string;
};

export type BridgeState = {
  running: boolean;
  threadId: string | null;
  turnId: string | null;
  lastError: string | null;
};

export async function startBridge(config: {
  convexUrl: string;
  actor: ActorContext;
  sessionId: string;
  codexBin?: string;
  model?: string;
  cwd?: string;
  deltaThrottleMs?: number;
  saveStreamDeltas?: boolean;
}) {
  return await invoke("start_bridge", { config });
}

export async function sendUserTurn(text: string) {
  return await invoke("send_user_turn", { text });
}

export async function interruptTurn() {
  return await invoke("interrupt_turn");
}

export async function stopBridge() {
  return await invoke("stop_bridge");
}

export async function getBridgeState(): Promise<BridgeState> {
  return await invoke("get_bridge_state");
}
