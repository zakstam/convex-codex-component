import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createTauriBridgeClient } from "@zakstam/codex-local-component/host/tauri";
import type { BridgeState } from "@zakstam/codex-local-component/host/tauri";

export type {
  ActorContext,
  BridgeState,
  CommandApprovalDecision,
  LoginAccountParams,
  StartBridgeConfig,
  ToolUserInputAnswer,
} from "@zakstam/codex-local-component/host/tauri";

type TauriInvokeCaptureEvent = {
  tsMs: number;
  phase: "invoke_start" | "invoke_success" | "invoke_error";
  command: string;
  args?: unknown;
  result?: unknown;
  error?: string;
};

type TauriInvokeCaptureListener = (event: TauriInvokeCaptureEvent) => void;

type GlobalWithInvokeCapture = typeof globalThis & {
  __codexTauriInvokeCaptureListeners?: Set<TauriInvokeCaptureListener>;
};

function invokeCaptureListenerSet(): Set<TauriInvokeCaptureListener> {
  const globalWithCapture = globalThis as GlobalWithInvokeCapture;
  if (!globalWithCapture.__codexTauriInvokeCaptureListeners) {
    globalWithCapture.__codexTauriInvokeCaptureListeners = new Set<TauriInvokeCaptureListener>();
  }
  return globalWithCapture.__codexTauriInvokeCaptureListeners;
}

function redactCaptureValue(value: unknown, keyHint?: string): unknown {
  const key = (keyHint ?? "").toLowerCase();
  if (
    key.includes("token") ||
    key.includes("apikey") ||
    key.includes("secret") ||
    key.includes("password")
  ) {
    return "<redacted>";
  }
  if (
    key === "text" ||
    key === "message" ||
    key === "line" ||
    key === "payloadjson" ||
    key === "inputtext"
  ) {
    return "<redacted>";
  }
  if (typeof value === "string") {
    return value.length > 128 ? `${value.slice(0, 128)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactCaptureValue(entry));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      out[entryKey] = redactCaptureValue(entryValue, entryKey);
    }
    return out;
  }
  return value;
}

function emitTauriInvokeCapture(event: TauriInvokeCaptureEvent): void {
  for (const listener of invokeCaptureListenerSet()) {
    listener(event);
  }
}

export function subscribeTauriInvokeCapture(listener: TauriInvokeCaptureListener): () => void {
  const listeners = invokeCaptureListenerSet();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const bridge = createTauriBridgeClient(
  async <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T> => {
    emitTauriInvokeCapture({
      tsMs: Date.now(),
      phase: "invoke_start",
      command,
      ...(args !== undefined ? { args: redactCaptureValue(args) } : {}),
    });
    try {
      const result = await invoke<T>(command, args);
      emitTauriInvokeCapture({
        tsMs: Date.now(),
        phase: "invoke_success",
        command,
        result: redactCaptureValue(result),
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitTauriInvokeCapture({
        tsMs: Date.now(),
        phase: "invoke_error",
        command,
        error: message,
      });
      throw error;
    }
  },
  {
    lifecycleSafeSend: true,
    subscribeBridgeState: async (listener) => {
      return listen<BridgeState>("codex:bridge_state", (event) => {
        listener(event.payload);
      });
    },
    subscribeGlobalMessage: async (listener) => {
      return listen<Record<string, unknown>>("codex:global_message", (event) => {
        listener(event.payload);
      });
    },
  },
);
