import {
  buildCommandExecutionApprovalResponse,
  buildDynamicToolCallResponse,
  buildFileChangeApprovalResponse,
  buildThreadArchiveRequest,
  buildThreadForkRequest,
  buildThreadListRequest,
  buildThreadLoadedListRequest,
  buildThreadReadRequest,
  buildThreadResumeRequest,
  buildThreadRollbackRequest,
  buildInitializeRequestWithCapabilities,
  buildInitializedNotification,
  buildThreadStartRequest,
  buildThreadUnarchiveRequest,
  buildToolRequestUserInputResponse,
  buildTurnInterruptRequest,
  buildTurnStartTextRequest,
  isUuidLikeThreadId,
} from "../app-server/client.js";
import { CodexLocalBridge, type BridgeConfig } from "../local-adapter/bridge.js";
import type {
  CodexResponse,
  NormalizedEvent,
  ServerInboundMessage,
  RpcId,
} from "../protocol/generated.js";
import type { ClientOutboundWireMessage } from "../protocol/outbound.js";
import type { CommandExecutionApprovalDecision } from "../protocol/schemas/v2/CommandExecutionApprovalDecision.js";
import type { FileChangeApprovalDecision } from "../protocol/schemas/v2/FileChangeApprovalDecision.js";
import type { ToolRequestUserInputAnswer } from "../protocol/schemas/v2/ToolRequestUserInputAnswer.js";
import type { ToolRequestUserInputQuestion } from "../protocol/schemas/v2/ToolRequestUserInputQuestion.js";
import type { DynamicToolCallOutputContentItem } from "../protocol/schemas/v2/DynamicToolCallOutputContentItem.js";
import type { DynamicToolSpec } from "../protocol/schemas/v2/DynamicToolSpec.js";
import type { ClientRequest } from "../protocol/schemas/ClientRequest.js";
import type { ThreadForkParams } from "../protocol/schemas/v2/ThreadForkParams.js";
import type { ThreadListParams } from "../protocol/schemas/v2/ThreadListParams.js";
import type { ThreadLoadedListParams } from "../protocol/schemas/v2/ThreadLoadedListParams.js";
import type { ThreadResumeParams } from "../protocol/schemas/v2/ThreadResumeParams.js";

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
type ClientMessage = ClientOutboundWireMessage;
type RequestMethod = ClientRequest["method"];
type ClientRequestMessage = ClientRequest;
type ManagedServerRequestMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "item/tool/requestUserInput"
  | "item/tool/call";

type PendingServerRequest = {
  requestId: RpcId;
  method: ManagedServerRequestMethod;
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string;
  questions?: ToolRequestUserInputQuestion[];
  payloadJson: string;
  createdAt: number;
};

type RuntimeServerRequestStatus = "pending" | "answered" | "expired";

export type HostRuntimePersistedServerRequest = {
  requestId: RpcId;
  method: ManagedServerRequestMethod;
  threadId: string;
  turnId: string;
  itemId: string;
  payloadJson: string;
  status: RuntimeServerRequestStatus;
  reason?: string;
  questions?: ToolRequestUserInputQuestion[];
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  responseJson?: string;
};

type RuntimeBridge = {
  start: () => void;
  stop: () => void;
  send: (message: ClientMessage) => void;
};

type PendingRequest = {
  method: string;
  resolve?: (message: CodexResponse) => void;
  reject?: (error: Error) => void;
};

export type HostRuntimeState = {
  running: boolean;
  threadId: string | null;
  externalThreadId: string | null;
  turnId: string | null;
  turnInFlight: boolean;
  pendingServerRequestCount: number;
  lastError: string | null;
};

export type HostRuntimeStartArgs = {
  actor: ActorContext;
  sessionId: string;
  externalThreadId?: string;
  runtimeThreadId?: string;
  threadStrategy?: "start" | "resume" | "fork";
  model?: string;
  cwd?: string;
  runtime?: {
    saveStreamDeltas?: boolean;
    saveReasoningDeltas?: boolean;
    exposeRawReasoningDeltas?: boolean;
    maxDeltasPerStreamRead?: number;
    maxDeltasPerRequestRead?: number;
    finishedStreamDeleteDelayMs?: number;
  };
  dynamicTools?: DynamicToolSpec[];
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
      saveReasoningDeltas?: boolean;
      exposeRawReasoningDeltas?: boolean;
      maxDeltasPerStreamRead?: number;
      maxDeltasPerRequestRead?: number;
      finishedStreamDeleteDelayMs?: number;
    };
  }) => Promise<{
    status: "ok" | "partial" | "session_recovered" | "rejected";
    errors: Array<{ code: string; message: string; recoverable: boolean }>;
  }>;
  upsertPendingServerRequest: (args: {
    actor: ActorContext;
    request: PendingServerRequest;
  }) => Promise<void>;
  resolvePendingServerRequest: (args: {
    actor: ActorContext;
    threadId: string;
    requestId: RpcId;
    status: Exclude<RuntimeServerRequestStatus, "pending">;
    resolvedAt: number;
    responseJson?: string;
  }) => Promise<void>;
  listPendingServerRequests: (args: {
    actor: ActorContext;
    threadId?: string;
  }) => Promise<HostRuntimePersistedServerRequest[]>;
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
  resumeThread: (
    runtimeThreadId: string,
    params?: Omit<ThreadResumeParams, "threadId"> & { dynamicTools?: DynamicToolSpec[] },
  ) => Promise<CodexResponse>;
  forkThread: (
    runtimeThreadId: string,
    params?: Omit<ThreadForkParams, "threadId">,
  ) => Promise<CodexResponse>;
  archiveThread: (runtimeThreadId: string) => Promise<CodexResponse>;
  unarchiveThread: (runtimeThreadId: string) => Promise<CodexResponse>;
  rollbackThread: (runtimeThreadId: string, numTurns: number) => Promise<CodexResponse>;
  readThread: (
    runtimeThreadId: string,
    includeTurns?: boolean,
  ) => Promise<CodexResponse>;
  listThreads: (params?: ThreadListParams) => Promise<CodexResponse>;
  listLoadedThreads: (params?: ThreadLoadedListParams) => Promise<CodexResponse>;
  listPendingServerRequests: (threadId?: string) => Promise<HostRuntimePersistedServerRequest[]>;
  respondCommandApproval: (args: {
    requestId: RpcId;
    decision: CommandExecutionApprovalDecision;
  }) => Promise<void>;
  respondFileChangeApproval: (args: {
    requestId: RpcId;
    decision: FileChangeApprovalDecision;
  }) => Promise<void>;
  respondToolUserInput: (args: {
    requestId: RpcId;
    answers: Record<string, ToolRequestUserInputAnswer>;
  }) => Promise<void>;
  respondDynamicToolCall: (args: {
    requestId: RpcId;
    success: boolean;
    contentItems: DynamicToolCallOutputContentItem[];
  }) => Promise<void>;
  getState: () => HostRuntimeState;
};

const MAX_BATCH_SIZE = 32;
const MANAGED_SERVER_REQUEST_METHODS = new Set<ManagedServerRequestMethod>([
  "item/commandExecution/requestApproval",
  "item/fileChange/requestApproval",
  "item/tool/requestUserInput",
  "item/tool/call",
]);

function toRequestKey(requestId: RpcId): string {
  return `${typeof requestId}:${String(requestId)}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function parseManagedServerRequestFromEvent(event: NormalizedEvent): PendingServerRequest | null {
  if (!MANAGED_SERVER_REQUEST_METHODS.has(event.kind as ManagedServerRequestMethod)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.payloadJson);
  } catch {
    return null;
  }

  const message = asObject(parsed);
  if (!message || typeof message.method !== "string") {
    return null;
  }
  if (!MANAGED_SERVER_REQUEST_METHODS.has(message.method as ManagedServerRequestMethod)) {
    return null;
  }
  if (typeof message.id !== "number" && typeof message.id !== "string") {
    return null;
  }
  const params = asObject(message.params);
  if (!params) {
    return null;
  }
  if (typeof params.threadId !== "string" || typeof params.turnId !== "string") {
    return null;
  }

  const method = message.method as ManagedServerRequestMethod;
  const itemId =
    typeof params.itemId === "string"
      ? params.itemId
      : method === "item/tool/call" && typeof params.callId === "string"
        ? params.callId
        : null;
  if (!itemId) {
    return null;
  }
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const questionsRaw = params.questions;
  const questions =
    method === "item/tool/requestUserInput" && Array.isArray(questionsRaw)
      ? (questionsRaw as ToolRequestUserInputQuestion[])
      : undefined;

  return {
    requestId: message.id as RpcId,
    method,
    threadId: params.threadId,
    turnId: params.turnId,
    itemId,
    payloadJson: event.payloadJson,
    createdAt: event.createdAt,
    ...(reason ? { reason } : {}),
    ...(questions ? { questions } : {}),
  };
}

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
  bridgeFactory?: (config: BridgeConfig, handlers: ConstructorParameters<typeof CodexLocalBridge>[1]) => RuntimeBridge;
  persistence: HostRuntimePersistence;
  handlers?: HostRuntimeHandlers;
}): CodexHostRuntime {
  let bridge: RuntimeBridge | null = null;
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
  const pendingServerRequests = new Map<string, PendingServerRequest>();

  const pendingRequests = new Map<number, PendingRequest>();

  const emitState = (lastError: string | null = null) => {
    args.handlers?.onState?.({
      running: !!bridge,
      threadId,
      externalThreadId,
      turnId,
      turnInFlight,
      pendingServerRequestCount: pendingServerRequests.size,
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

  const assertRuntimeReady = (): RuntimeBridge => {
    if (!bridge) {
      throw new Error("Bridge not started");
    }
    return bridge;
  };

  const methodForRequest = (message: ClientRequestMessage): RequestMethod => message.method;

  const sendMessage = (message: ClientMessage, trackedMethod?: string) => {
    const runtimeBridge = assertRuntimeReady();
    runtimeBridge.send(message);
    if ("id" in message && typeof message.id === "number" && trackedMethod) {
      pendingRequests.set(message.id, { method: trackedMethod });
    }
  };

  const sendRequest = (message: ClientRequestMessage): Promise<CodexResponse> => {
    const runtimeBridge = assertRuntimeReady();
    if (typeof message.id !== "number") {
      throw new Error("Runtime requires numeric request ids.");
    }
    const messageId = message.id;
    return new Promise<CodexResponse>((resolve, reject) => {
      pendingRequests.set(messageId, { method: methodForRequest(message), resolve, reject });
      runtimeBridge.send(message);
    });
  };

  const registerPendingServerRequest = async (request: PendingServerRequest) => {
    pendingServerRequests.set(toRequestKey(request.requestId), request);
    if (actor) {
      await args.persistence.upsertPendingServerRequest({ actor, request });
    }
    emitState();
  };

  const resolvePendingServerRequest = async (argsForResolve: {
    requestId: RpcId;
    status: Exclude<RuntimeServerRequestStatus, "pending">;
    responseJson?: string;
  }) => {
    const key = toRequestKey(argsForResolve.requestId);
    const pending = pendingServerRequests.get(key);
    if (!pending) {
      return;
    }
    pendingServerRequests.delete(key);
    if (actor) {
      await args.persistence.resolvePendingServerRequest({
        actor,
        threadId: pending.threadId,
        requestId: pending.requestId,
        status: argsForResolve.status,
        resolvedAt: Date.now(),
        ...(argsForResolve.responseJson ? { responseJson: argsForResolve.responseJson } : {}),
      });
    }
    emitState();
  };

  const expireTurnServerRequests = async (turn: { threadId: string; turnId?: string | null }) => {
    if (!turn.turnId) {
      return;
    }
    const idsToExpire: RpcId[] = [];
    for (const request of pendingServerRequests.values()) {
      if (request.threadId === turn.threadId && request.turnId === turn.turnId) {
        idsToExpire.push(request.requestId);
      }
    }
    for (const requestId of idsToExpire) {
      await resolvePendingServerRequest({ requestId, status: "expired" });
    }
  };

  const getPendingServerRequest = (requestId: RpcId): PendingServerRequest => {
    const pending = pendingServerRequests.get(toRequestKey(requestId));
    if (!pending) {
      throw new Error(`No pending server request found for id ${String(requestId)}`);
    }
    return pending;
  };

  const sendServerRequestResponse = async (
    requestId: RpcId,
    responseMessage: ClientOutboundWireMessage,
  ): Promise<void> => {
    getPendingServerRequest(requestId);
    sendMessage(responseMessage);
    await resolvePendingServerRequest({
      requestId,
      status: "answered",
      responseJson: JSON.stringify(responseMessage),
    });
  };

  const throwIfTurnMutationLocked = () => {
    if (turnInFlight && !turnSettled) {
      throw new Error("Cannot change thread lifecycle while a turn is in flight.");
    }
  };

  const setRuntimeThreadFromResponse = (message: CodexResponse, method: string) => {
    if (message.error || !message.result || typeof message.result !== "object") {
      return;
    }
    if (!("thread" in message.result) || typeof message.result.thread !== "object" || message.result.thread === null) {
      return;
    }
    if (!("id" in message.result.thread) || typeof message.result.thread.id !== "string") {
      return;
    }
    if (method === "thread/start" || method === "thread/resume" || method === "thread/fork") {
      runtimeThreadId = message.result.thread.id;
      if (!externalThreadId) {
        externalThreadId = message.result.thread.id;
      }
      emitState();
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

    const bridgeHandlers: ConstructorParameters<typeof CodexLocalBridge>[1] = {
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
            await expireTurnServerRequests({
              threadId: threadId ?? event.threadId,
              ...(event.turnId ? { turnId: event.turnId } : {}),
            });
          }
          if (event.kind === "error") {
            turnInFlight = false;
            turnSettled = true;
            if (!event.turnId || event.turnId === turnId) {
              turnId = null;
            }
            emitState();
            await expireTurnServerRequests({
              threadId: threadId ?? event.threadId,
              ...(event.turnId ? { turnId: event.turnId } : {}),
            });
          }

          const pendingServerRequest = parseManagedServerRequestFromEvent(event);
          if (pendingServerRequest) {
            const persistedThreadId = threadId;
            if (persistedThreadId) {
              await registerPendingServerRequest({
                ...pendingServerRequest,
                threadId: persistedThreadId,
              });
            }
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
            if (pending) {
              setRuntimeThreadFromResponse(message, pending.method);
            }
            if (message.error && pending?.method === "turn/start") {
              turnInFlight = false;
              turnSettled = true;
              turnId = null;
              emitState();
            }
            if (pending?.resolve) {
              if (message.error) {
                const code = typeof message.error.code === "number" ? String(message.error.code) : "UNKNOWN";
                pending.reject?.(new Error(`[${code}] ${message.error.message}`));
              } else {
                pending.resolve(message);
              }
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
      };
    bridge = args.bridgeFactory
      ? args.bridgeFactory(bridgeConfig, bridgeHandlers)
      : new CodexLocalBridge(bridgeConfig, bridgeHandlers);

    bridge.start();

    sendMessage(
      buildInitializeRequestWithCapabilities(
        requestId(),
        {
          name: "codex_local_host_runtime",
          title: "Codex Local Host Runtime",
          version: "0.1.0",
        },
        {
          experimentalApi: Array.isArray(startArgs.dynamicTools) && startArgs.dynamicTools.length > 0,
        },
      ),
      "initialize",
    );
    sendMessage(buildInitializedNotification());
    const strategy = startArgs.threadStrategy ?? "start";
    if ((strategy === "resume" || strategy === "fork") && !startArgs.runtimeThreadId) {
      throw new Error(`runtimeThreadId is required when threadStrategy=\"${strategy}\".`);
    }

    if (strategy === "start") {
      sendMessage(
        buildThreadStartRequest(requestId(), {
          ...(startArgs.model ? { model: startArgs.model } : {}),
          ...(startArgs.cwd ? { cwd: startArgs.cwd } : {}),
          ...(startArgs.dynamicTools ? { dynamicTools: startArgs.dynamicTools } : {}),
        }),
        "thread/start",
      );
    } else if (strategy === "resume") {
      sendMessage(
        buildThreadResumeRequest(requestId(), {
          threadId: startArgs.runtimeThreadId!,
          ...(startArgs.model ? { model: startArgs.model } : {}),
          ...(startArgs.cwd ? { cwd: startArgs.cwd } : {}),
          ...(startArgs.dynamicTools ? { dynamicTools: startArgs.dynamicTools } : {}),
        }),
        "thread/resume",
      );
    } else {
      sendMessage(
        buildThreadForkRequest(requestId(), {
          threadId: startArgs.runtimeThreadId!,
          ...(startArgs.model ? { model: startArgs.model } : {}),
          ...(startArgs.cwd ? { cwd: startArgs.cwd } : {}),
        }),
        "thread/fork",
      );
    }

    emitState();
  };

  const stop = async () => {
    clearFlushTimer();
    await flushQueue();
    for (const [, pending] of pendingRequests) {
      pending.reject?.(new Error("Bridge stopped before request completed."));
    }
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
    pendingServerRequests.clear();
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

  const resumeThread = async (
    nextRuntimeThreadId: string,
    params?: Omit<ThreadResumeParams, "threadId"> & { dynamicTools?: DynamicToolSpec[] },
  ): Promise<CodexResponse> => {
    throwIfTurnMutationLocked();
    return sendRequest(
      buildThreadResumeRequest(requestId(), {
        threadId: nextRuntimeThreadId,
        ...(params ?? {}),
      }),
    );
  };

  const forkThread = async (
    sourceRuntimeThreadId: string,
    params?: Omit<ThreadForkParams, "threadId">,
  ): Promise<CodexResponse> => {
    throwIfTurnMutationLocked();
    return sendRequest(
      buildThreadForkRequest(requestId(), {
        threadId: sourceRuntimeThreadId,
        ...(params ?? {}),
      }),
    );
  };

  const archiveThread = async (targetRuntimeThreadId: string): Promise<CodexResponse> => {
    throwIfTurnMutationLocked();
    return sendRequest(
      buildThreadArchiveRequest(requestId(), {
        threadId: targetRuntimeThreadId,
      }),
    );
  };

  const unarchiveThread = async (targetRuntimeThreadId: string): Promise<CodexResponse> => {
    throwIfTurnMutationLocked();
    return sendRequest(
      buildThreadUnarchiveRequest(requestId(), {
        threadId: targetRuntimeThreadId,
      }),
    );
  };

  const rollbackThread = async (targetRuntimeThreadId: string, numTurns: number): Promise<CodexResponse> => {
    throwIfTurnMutationLocked();
    return sendRequest(
      buildThreadRollbackRequest(requestId(), {
        threadId: targetRuntimeThreadId,
        numTurns,
      }),
    );
  };

  const readThread = async (
    targetRuntimeThreadId: string,
    includeTurns = false,
  ): Promise<CodexResponse> =>
    sendRequest(
      buildThreadReadRequest(requestId(), {
        threadId: targetRuntimeThreadId,
        includeTurns,
      }),
    );

  const listThreads = async (params?: ThreadListParams): Promise<CodexResponse> =>
    sendRequest(buildThreadListRequest(requestId(), params));

  const listLoadedThreads = async (params?: ThreadLoadedListParams): Promise<CodexResponse> =>
    sendRequest(buildThreadLoadedListRequest(requestId(), params));

  const listPendingServerRequests = async (
    threadIdFilter?: string,
  ): Promise<HostRuntimePersistedServerRequest[]> => {
    if (actor) {
      return args.persistence.listPendingServerRequests({
        actor,
        ...(threadIdFilter ? { threadId: threadIdFilter } : {}),
      });
    }
    return [];
  };

  const respondCommandApproval = async (argsForDecision: {
    requestId: RpcId;
    decision: CommandExecutionApprovalDecision;
  }): Promise<void> => {
    const pending = getPendingServerRequest(argsForDecision.requestId);
    if (pending.method !== "item/commandExecution/requestApproval") {
      throw new Error(
        `Server request ${String(argsForDecision.requestId)} is ${pending.method}, expected item/commandExecution/requestApproval`,
      );
    }
    await sendServerRequestResponse(
      argsForDecision.requestId,
      buildCommandExecutionApprovalResponse(argsForDecision.requestId, argsForDecision.decision),
    );
  };

  const respondFileChangeApproval = async (argsForDecision: {
    requestId: RpcId;
    decision: FileChangeApprovalDecision;
  }): Promise<void> => {
    const pending = getPendingServerRequest(argsForDecision.requestId);
    if (pending.method !== "item/fileChange/requestApproval") {
      throw new Error(
        `Server request ${String(argsForDecision.requestId)} is ${pending.method}, expected item/fileChange/requestApproval`,
      );
    }
    await sendServerRequestResponse(
      argsForDecision.requestId,
      buildFileChangeApprovalResponse(argsForDecision.requestId, argsForDecision.decision),
    );
  };

  const respondToolUserInput = async (argsForAnswer: {
    requestId: RpcId;
    answers: Record<string, ToolRequestUserInputAnswer>;
  }): Promise<void> => {
    const pending = getPendingServerRequest(argsForAnswer.requestId);
    if (pending.method !== "item/tool/requestUserInput") {
      throw new Error(
        `Server request ${String(argsForAnswer.requestId)} is ${pending.method}, expected item/tool/requestUserInput`,
      );
    }
    await sendServerRequestResponse(
      argsForAnswer.requestId,
      buildToolRequestUserInputResponse(argsForAnswer.requestId, argsForAnswer.answers),
    );
  };

  const respondDynamicToolCall = async (argsForResult: {
    requestId: RpcId;
    success: boolean;
    contentItems: DynamicToolCallOutputContentItem[];
  }): Promise<void> => {
    const pending = getPendingServerRequest(argsForResult.requestId);
    if (pending.method !== "item/tool/call") {
      throw new Error(
        `Server request ${String(argsForResult.requestId)} is ${pending.method}, expected item/tool/call`,
      );
    }
    await sendServerRequestResponse(
      argsForResult.requestId,
      buildDynamicToolCallResponse(argsForResult.requestId, {
        success: argsForResult.success,
        contentItems: argsForResult.contentItems,
      }),
    );
  };

  const getState = (): HostRuntimeState => ({
    running: !!bridge,
    threadId,
    externalThreadId,
    turnId,
    turnInFlight,
    pendingServerRequestCount: pendingServerRequests.size,
    lastError: null,
  });

  return {
    start,
    stop,
    sendTurn,
    interrupt,
    resumeThread,
    forkThread,
    archiveThread,
    unarchiveThread,
    rollbackThread,
    readThread,
    listThreads,
    listLoadedThreads,
    listPendingServerRequests,
    respondCommandApproval,
    respondFileChangeApproval,
    respondToolUserInput,
    respondDynamicToolCall,
    getState,
  };
}
