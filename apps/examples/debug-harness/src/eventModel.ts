export type HelperStateEvent = {
  type: "state";
  payload: {
    running: boolean;
    phase: "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
    source: "runtime" | "bridge_event" | "protocol_error" | "process_exit";
    updatedAtMs: number;
    localThreadId: string | null;
    conversationId: string | null;
    turnId: string | null;
    lastErrorCode: string | null;
    lastError: string | null;
    pendingServerRequestCount: number;
    ingestEnqueuedEventCount: number;
    ingestSkippedEventCount: number;
    ingestEnqueuedByKind: Array<{ kind: string; count: number }>;
    ingestSkippedByKind: Array<{ kind: string; count: number }>;
    disabledTools: string[];
  };
};

export type HelperProtocolEvent = {
  type: "event";
  payload: {
    kind: string;
    threadId: string;
    turnId?: string;
    streamId?: string;
  };
};

export type HelperGlobalEvent = {
  type: "global";
  payload: Record<string, unknown>;
};

export type HelperProtocolErrorEvent = {
  type: "protocol_error";
  payload: { message: string; line: string };
};

export type HelperAckEvent = {
  type: "ack";
  payload: { command: string };
};

export type HelperErrorEvent = {
  type: "error";
  payload: { message: string };
};

export type HelperEvent =
  | HelperStateEvent
  | HelperProtocolEvent
  | HelperGlobalEvent
  | HelperProtocolErrorEvent
  | HelperAckEvent
  | HelperErrorEvent;

export type HarnessEvent = {
  ts: number;
  source: "stdin" | "stdout" | "stderr" | "system";
  label: string;
  payload: unknown;
  correlatedCommandId?: string;
};

export type BridgeSnapshot = HelperStateEvent["payload"];

export const EMPTY_SNAPSHOT: BridgeSnapshot = {
  running: false,
  phase: "idle",
  source: "runtime",
  updatedAtMs: 0,
  localThreadId: null,
  conversationId: null,
  turnId: null,
  lastErrorCode: null,
  lastError: null,
  pendingServerRequestCount: 0,
  ingestEnqueuedEventCount: 0,
  ingestSkippedEventCount: 0,
  ingestEnqueuedByKind: [],
  ingestSkippedByKind: [],
  disabledTools: [],
};

export function isHelperEvent(value: unknown): value is HelperEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const type = Reflect.get(value, "type");
  return type === "state"
    || type === "event"
    || type === "global"
    || type === "protocol_error"
    || type === "ack"
    || type === "error";
}
