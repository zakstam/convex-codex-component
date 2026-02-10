import {
  buildInitializeRequest,
  buildInitializedNotification,
  buildThreadStartRequest,
  buildTurnInterruptRequest,
  buildTurnStartTextRequest,
  isUuidLikeThreadId,
} from "../app-server/client.js";
import { CodexLocalBridge, type BridgeConfig } from "../local-adapter/bridge.js";
import type {
  ClientOutboundMessage,
  CodexResponse,
  NormalizedEvent,
  ServerInboundMessage,
} from "../protocol/generated.js";

type ActorContext = { tenantId: string; userId: string; deviceId: string };

type StreamIngestDelta = {
  type: "stream_delta";
  eventId: string;
  kind: string;
  payloadJson: string;
  cursorStart: number;
  cursorEnd: number;
  createdAt: number;
  threadId: string;
  turnId: string;
  streamId: string;
};

type LifecycleIngestEvent = {
  type: "lifecycle_event";
  eventId: string;
  kind: string;
  payloadJson: string;
  createdAt: number;
  threadId: string;
  turnId?: string;
};

type IngestDelta = StreamIngestDelta | LifecycleIngestEvent;
type ClientMessage = ClientOutboundMessage;

export type HostRuntimeState = {
  running: boolean;
  threadId: string | null;
  externalThreadId: string | null;
  turnId: string | null;
  turnInFlight: boolean;
  lastError: string | null;
};

export type HostRuntimeStartArgs = {
  actor: ActorContext;
  sessionId: string;
  externalThreadId?: string;
  model?: string;
  cwd?: string;
  runtime?: {
    saveStreamDeltas?: boolean;
    maxDeltasPerStreamRead?: number;
    maxDeltasPerRequestRead?: number;
    finishedStreamDeleteDelayMs?: number;
  };
  ingestFlushMs?: number;
};

export type HostRuntimePersistence = {
  ensureThread: (args: {
    actor: ActorContext;
    externalThreadId?: string;
    model?: string;
    cwd?: string;
    localThreadId?: string;
  }) => Promise<{ threadId: string; externalThreadId?: string; created: boolean }>;
  ensureSession: (args: {
    actor: ActorContext;
    sessionId: string;
    threadId: string;
    lastEventCursor: number;
  }) => Promise<{ sessionId: string; threadId: string; status: "created" | "active" }>;
  ingestSafe: (args: {
    actor: ActorContext;
    sessionId: string;
    threadId: string;
    deltas: IngestDelta[];
    runtime?: {
      saveStreamDeltas?: boolean;
      maxDeltasPerStreamRead?: number;
      maxDeltasPerRequestRead?: number;
      finishedStreamDeleteDelayMs?: number;
    };
  }) => Promise<{
    status: "ok" | "partial" | "session_recovered" | "rejected";
    errors: Array<{ code: string; message: string; recoverable: boolean }>;
  }>;
};

export type HostRuntimeHandlers = {
  onState?: (state: HostRuntimeState) => void;
  onEvent?: (event: NormalizedEvent) => void;
  onGlobalMessage?: (message: ServerInboundMessage) => void;
  onProtocolError?: (error: { message: string; line: string }) => void;
};

export type CodexHostRuntime = {
  start: (args: HostRuntimeStartArgs) => Promise<void>;
  stop: () => Promise<void>;
  sendTurn: (text: string) => void;
  interrupt: () => void;
  getState: () => HostRuntimeState;
};

const MAX_BATCH_SIZE = 32;
function randomSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isServerNotification(message: ServerInboundMessage): message is ServerInboundMessage & { method: string } {
  return "method" in message;
}

function isResponse(message: ServerInboundMessage): message is CodexResponse {
  return "id" in message && !isServerNotification(message);
}

export function createCodexHostRuntime(args: {
  bridge?: BridgeConfig;
  persistence: HostRuntimePersistence;
  handlers?: HostRuntimeHandlers;
}): CodexHostRuntime {
  let bridge: CodexLocalBridge | null = null;
  let actor: ActorContext | null = null;
  let sessionId: string | null = null;
  let threadId: string | null = null;
  let runtimeThreadId: string | null = null;
  let externalThreadId: string | null = null;
  let turnId: string | null = null;
  let turnInFlight = false;
  let turnSettled = false;
  let interruptRequested = false;
  let nextRequestId = 1;

  let ingestQueue: IngestDelta[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTail: Promise<void> = Promise.resolve();
  let ingestFlushMs = 250;

  const pendingRequests = new Map<number, { method: string }>();

  const emitState = (lastError: string | null = null) => {
    args.handlers?.onState?.({
      running: !!bridge,
      threadId,
      externalThreadId,
      turnId,
      turnInFlight,
      lastError,
    });
  };

  const clearFlushTimer = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  const requestId = () => {
    const id = nextRequestId;
    nextRequestId += 1;
    return id;
  };

  const sendMessage = (message: ClientMessage, trackedMethod?: string) => {
    if (!bridge) {
      throw new Error("Bridge not started");
    }
    bridge.send(message);
    if ("id" in message && typeof message.id === "number" && trackedMethod) {
      pendingRequests.set(message.id, { method: trackedMethod });
    }
  };

  const flushQueue = async () => {
    if (!actor || !sessionId || !threadId) {
      return;
    }
    const activeActor = actor;
    const activeSessionId = sessionId;
    const activeThreadId = threadId;

    const next = flushTail.then(async () => {
      clearFlushTimer();
      while (ingestQueue.length > 0) {
        const batch = ingestQueue.splice(0, MAX_BATCH_SIZE);
        const result = await args.persistence.ingestSafe({
          actor: activeActor,
          sessionId: activeSessionId,
          threadId: activeThreadId,
          deltas: batch,
        });
        if (result.status === "rejected") {
          throw new Error(`ingestSafe rejected: ${result.errors.map((err) => err.code).join(",")}`);
        }
      }
    });

    flushTail = next.catch(() => undefined);
    await next;
  };

  const enqueueIngestDelta = async (delta: IngestDelta, forceFlush: boolean) => {
    ingestQueue.push(delta);

    if (forceFlush || ingestQueue.length >= MAX_BATCH_SIZE) {
      await flushQueue();
      return;
    }

    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushQueue();
      }, turnInFlight ? ingestFlushMs : 5000);
    }
  };

  const start = async (startArgs: HostRuntimeStartArgs): Promise<void> => {
    if (bridge) {
      emitState();
      return;
    }

    actor = startArgs.actor;
    sessionId = startArgs.sessionId ? `${startArgs.sessionId}-${randomSessionId()}` : randomSessionId();
    externalThreadId = startArgs.externalThreadId ?? null;
    ingestFlushMs = startArgs.ingestFlushMs ?? 250;

    const bridgeConfig: BridgeConfig = {};
    if (args.bridge?.codexBin !== undefined) {
      bridgeConfig.codexBin = args.bridge.codexBin;
    }
    const resolvedCwd = startArgs.cwd ?? args.bridge?.cwd;
    if (resolvedCwd !== undefined) {
      bridgeConfig.cwd = resolvedCwd;
    }

    bridge = new CodexLocalBridge(
      bridgeConfig,
      {
        onEvent: async (event) => {
          if (!actor || !sessionId) {
            return;
          }

          if (
            !runtimeThreadId ||
            (!isUuidLikeThreadId(runtimeThreadId) && isUuidLikeThreadId(event.threadId))
          ) {
            runtimeThreadId = event.threadId;
          }

          if (!threadId) {
            const binding = await args.persistence.ensureThread({
              actor,
              externalThreadId: externalThreadId ?? runtimeThreadId,
              ...(startArgs.model !== undefined ? { model: startArgs.model } : {}),
              ...(startArgs.cwd !== undefined ? { cwd: startArgs.cwd } : {}),
              localThreadId: event.threadId,
            });
            threadId = binding.threadId;
            externalThreadId = binding.externalThreadId ?? runtimeThreadId;

            await args.persistence.ensureSession({
              actor,
              sessionId,
              threadId,
              lastEventCursor: 0,
            });
            emitState();
          }

          if (event.kind === "turn/started" && event.turnId) {
            turnId = event.turnId;
            turnInFlight = true;
            turnSettled = false;
            emitState();
            if (interruptRequested) {
              if (!runtimeThreadId) {
                return;
              }
              sendMessage(
                buildTurnInterruptRequest(requestId(), {
                  threadId: runtimeThreadId,
                  turnId: event.turnId,
                }),
                "turn/interrupt",
              );
              interruptRequested = false;
            }
          }

          if (event.kind === "turn/completed") {
            turnId = null;
            turnInFlight = false;
            turnSettled = true;
            emitState();
          }
          if (event.kind === "error") {
            turnInFlight = false;
            turnSettled = true;
            if (!event.turnId || event.turnId === turnId) {
              turnId = null;
            }
            emitState();
          }

          args.handlers?.onEvent?.(event);

          const persistedThreadId = threadId;
          if (!persistedThreadId) {
            return;
          }

          const delta: IngestDelta =
            event.streamId && event.turnId
              ? {
                  type: "stream_delta",
                  eventId: event.eventId,
                  kind: event.kind,
                  payloadJson: event.payloadJson,
                  cursorStart: event.cursorStart,
                  cursorEnd: event.cursorEnd,
                  createdAt: event.createdAt,
                  threadId: persistedThreadId,
                  turnId: event.turnId,
                  streamId: event.streamId,
                }
              : {
                  type: "lifecycle_event",
                  eventId: event.eventId,
                  kind: event.kind,
                  payloadJson: event.payloadJson,
                  createdAt: event.createdAt,
                  threadId: persistedThreadId,
                  ...(event.turnId ? { turnId: event.turnId } : {}),
                };

          const forceFlush =
            event.kind === "turn/completed" ||
            event.kind === "error";

          await enqueueIngestDelta(delta, forceFlush);
        },
        onGlobalMessage: async (message) => {
          if (isResponse(message) && typeof message.id === "number") {
            const pending = pendingRequests.get(message.id);
            pendingRequests.delete(message.id);
            if (
              pending?.method === "thread/start" &&
              !message.error &&
              message.result &&
              typeof message.result === "object" &&
              "thread" in message.result &&
              typeof message.result.thread === "object" &&
              message.result.thread !== null &&
              "id" in message.result.thread &&
              typeof message.result.thread.id === "string"
            ) {
              runtimeThreadId = message.result.thread.id;
            }
            if (message.error && pending?.method === "turn/start") {
              turnInFlight = false;
              turnSettled = true;
              turnId = null;
              emitState();
            }
          }
          args.handlers?.onGlobalMessage?.(message);
        },
        onProtocolError: async ({ line, error }) => {
          const message = error instanceof Error ? error.message : String(error);
          emitState(message);
          args.handlers?.onProtocolError?.({ message, line });
        },
        onProcessExit: (code) => {
          emitState(`codex exited with code ${String(code)}`);
        },
      },
    );

    bridge.start();

    sendMessage(
      buildInitializeRequest(requestId(), {
        name: "codex_local_host_runtime",
        title: "Codex Local Host Runtime",
        version: "0.1.0",
      }),
      "initialize",
    );
    sendMessage(buildInitializedNotification());
    sendMessage(
      buildThreadStartRequest(requestId(), {
        ...(startArgs.model ? { model: startArgs.model } : {}),
        ...(startArgs.cwd ? { cwd: startArgs.cwd } : {}),
      }),
      "thread/start",
    );

    emitState();
  };

  const stop = async () => {
    clearFlushTimer();
    await flushQueue();
    bridge?.stop();
    bridge = null;
    actor = null;
    sessionId = null;
    threadId = null;
    runtimeThreadId = null;
    externalThreadId = null;
    turnId = null;
    turnInFlight = false;
    turnSettled = false;
    interruptRequested = false;
    pendingRequests.clear();
    emitState();
  };

  const sendTurn = (text: string) => {
    if (!bridge || !runtimeThreadId) {
      throw new Error("Bridge/thread not ready. Start runtime first.");
    }
    if (turnInFlight && !turnSettled) {
      throw new Error("A turn is already in flight.");
    }

    turnInFlight = true;
    turnSettled = false;
    emitState();

    sendMessage(
      buildTurnStartTextRequest(requestId(), {
        threadId: runtimeThreadId,
        text,
      }),
      "turn/start",
    );
  };

  const interrupt = () => {
    if (!bridge || !runtimeThreadId) {
      return;
    }
    if (!turnId) {
      interruptRequested = true;
      return;
    }
    sendMessage(buildTurnInterruptRequest(requestId(), { threadId: runtimeThreadId, turnId }), "turn/interrupt");
  };

  const getState = (): HostRuntimeState => ({
    running: !!bridge,
    threadId,
    externalThreadId,
    turnId,
    turnInFlight,
    lastError: null,
  });

  return {
    start,
    stop,
    sendTurn,
    interrupt,
    getState,
  };
}
