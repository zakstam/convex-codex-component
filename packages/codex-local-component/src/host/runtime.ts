import {
  buildAccountLoginCancelRequest,
  buildAccountLoginStartRequest,
  buildAccountLogoutRequest,
  buildAccountRateLimitsReadRequest,
  buildAccountReadRequest,
  buildChatgptAuthTokensRefreshResponse,
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
import type { CancelLoginAccountParams } from "../protocol/schemas/v2/CancelLoginAccountParams.js";
import type { FileChangeApprovalDecision } from "../protocol/schemas/v2/FileChangeApprovalDecision.js";
import type { ToolRequestUserInputAnswer } from "../protocol/schemas/v2/ToolRequestUserInputAnswer.js";
import type { ToolRequestUserInputQuestion } from "../protocol/schemas/v2/ToolRequestUserInputQuestion.js";
import type { LoginAccountParams } from "../protocol/schemas/v2/LoginAccountParams.js";
import type { DynamicToolCallOutputContentItem } from "../protocol/schemas/v2/DynamicToolCallOutputContentItem.js";
import type { DynamicToolSpec } from "../protocol/schemas/v2/DynamicToolSpec.js";
import type { ChatgptAuthTokensRefreshParams } from "../protocol/schemas/v2/ChatgptAuthTokensRefreshParams.js";
import type { ClientRequest } from "../protocol/schemas/ClientRequest.js";
import type { ThreadForkParams } from "../protocol/schemas/v2/ThreadForkParams.js";
import type { ThreadListParams } from "../protocol/schemas/v2/ThreadListParams.js";
import type { ThreadLoadedListParams } from "../protocol/schemas/v2/ThreadLoadedListParams.js";
import type { ThreadResumeParams } from "../protocol/schemas/v2/ThreadResumeParams.js";
import { normalizeInboundDeltas } from "./normalizeInboundDeltas.js";
import { terminalStatusForPayload } from "../protocol/events.js";

type ActorContext = { userId?: string };

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
type IngestSafeError = { code: string; message: string; recoverable: boolean };
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

const PENDING_SERVER_REQUEST_RETRY_DELAY_MS = 150;
const PENDING_SERVER_REQUEST_RETRY_TTL_MS = 5_000;
const PENDING_SERVER_REQUEST_MAX_RETRIES = 20;

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

function shouldDropRejectedIngestBatch(errors: IngestSafeError[]): boolean {
  if (errors.length === 0) {
    return false;
  }
  return errors.every((error) => error.code === "OUT_OF_ORDER");
}

function isTurnNotFoundPersistenceError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Turn not found:");
}

type PendingRequest = {
  method: string;
  dispatchId?: string;
  claimToken?: string;
  turnId?: string;
  dispatchSource?: "runtime_queue" | "external_claim";
  resolve?: (message: CodexResponse) => void;
  reject?: (error: Error) => void;
};

type PendingServerRequestRetryEntry = {
  request: PendingServerRequest;
  attempts: number;
  firstQueuedAt: number;
  lastError: string;
};

type PendingAuthTokensRefreshRequest = {
  requestId: RpcId;
  params: ChatgptAuthTokensRefreshParams;
  createdAt: number;
};

export type HostRuntimeState = {
  running: boolean;
  dispatchManaged: boolean | null;
  threadId: string | null;
  externalThreadId: string | null;
  turnId: string | null;
  turnInFlight: boolean;
  pendingServerRequestCount: number;
  ingestMetrics: {
    enqueuedEventCount: number;
    skippedEventCount: number;
    enqueuedByKind: Array<{ kind: string; count: number }>;
    skippedByKind: Array<{ kind: string; count: number }>;
  };
  lastErrorCode: HostRuntimeErrorCode | null;
  lastError: string | null;
};

export type HostRuntimeErrorCode =
  | "E_RUNTIME_DISPATCH_MODE_REQUIRED"
  | "E_RUNTIME_DISPATCH_MODE_CONFLICT"
  | "E_RUNTIME_DISPATCH_EXTERNAL_CLAIM_ACTIVE"
  | "E_RUNTIME_DISPATCH_TURN_IN_FLIGHT"
  | "E_RUNTIME_DISPATCH_CLAIM_INVALID"
  | "E_RUNTIME_PROTOCOL_EVENT_INVALID"
  | "E_RUNTIME_INGEST_FLUSH_FAILED";

export class CodexHostRuntimeError extends Error {
  readonly code: HostRuntimeErrorCode;

  constructor(code: HostRuntimeErrorCode, message: string) {
    super(`[${code}] ${message}`);
    this.name = "CodexHostRuntimeError";
    this.code = code;
  }
}

export type HostRuntimeStartArgs = {
  actor: ActorContext;
  sessionId: string;
  dispatchManaged: boolean;
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
  enqueueTurnDispatch: (args: {
    actor: ActorContext;
    threadId: string;
    dispatchId?: string;
    turnId: string;
    idempotencyKey: string;
    input: Array<{
      type: string;
      text?: string;
      url?: string;
      path?: string;
    }>;
  }) => Promise<{
    dispatchId: string;
    turnId: string;
    status: "queued" | "claimed" | "started" | "completed" | "failed" | "cancelled";
    accepted: boolean;
  }>;
  claimNextTurnDispatch: (args: {
    actor: ActorContext;
    threadId: string;
    claimOwner: string;
    leaseMs?: number;
  }) => Promise<{
    dispatchId: string;
    turnId: string;
    idempotencyKey: string;
    inputText: string;
    claimToken: string;
    leaseExpiresAt: number;
    attemptCount: number;
  } | null>;
  markTurnDispatchStarted: (args: {
    actor: ActorContext;
    threadId: string;
    dispatchId: string;
    claimToken: string;
    runtimeThreadId?: string;
    runtimeTurnId?: string;
  }) => Promise<void>;
  markTurnDispatchCompleted: (args: {
    actor: ActorContext;
    threadId: string;
    dispatchId: string;
    claimToken: string;
  }) => Promise<void>;
  markTurnDispatchFailed: (args: {
    actor: ActorContext;
    threadId: string;
    dispatchId: string;
    claimToken: string;
    code?: string;
    reason: string;
  }) => Promise<void>;
  cancelTurnDispatch: (args: {
    actor: ActorContext;
    threadId: string;
    dispatchId: string;
    claimToken?: string;
    reason: string;
  }) => Promise<void>;
  upsertTokenUsage?: (args: {
    actor: ActorContext;
    threadId: string;
    turnId: string;
    totalTokens: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    lastTotalTokens: number;
    lastInputTokens: number;
    lastCachedInputTokens: number;
    lastOutputTokens: number;
    lastReasoningOutputTokens: number;
    modelContextWindow?: number;
  }) => Promise<void>;
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
  // TODO(turn/steer): Expose a `steerTurn(...)` API for mid-turn guidance when turn/steer is wired.
  startClaimedTurn: (args: {
    dispatchId: string;
    claimToken: string;
    turnId: string;
    inputText: string;
    idempotencyKey?: string;
  }) => Promise<void>;
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
  readAccount: (params?: { refreshToken?: boolean }) => Promise<CodexResponse>;
  loginAccount: (params: LoginAccountParams) => Promise<CodexResponse>;
  cancelAccountLogin: (params: CancelLoginAccountParams) => Promise<CodexResponse>;
  logoutAccount: () => Promise<CodexResponse>;
  readAccountRateLimits: () => Promise<CodexResponse>;
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
  respondChatgptAuthTokensRefresh: (args: {
    requestId: RpcId;
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType?: string | null;
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
const TURN_SCOPED_EVENT_PREFIXES = ["turn/", "item/"];

function toRequestKey(requestId: RpcId): string {
  return `${typeof requestId}:${String(requestId)}`;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function isRpcId(value: unknown): value is RpcId {
  return typeof value === "string" || typeof value === "number";
}

function isManagedServerRequestMethod(value: string): value is ManagedServerRequestMethod {
  return (
    value === "item/commandExecution/requestApproval" ||
    value === "item/fileChange/requestApproval" ||
    value === "item/tool/requestUserInput" ||
    value === "item/tool/call"
  );
}

function isToolRequestUserInputQuestion(value: unknown): value is ToolRequestUserInputQuestion {
  const question = asObject(value);
  if (!question) {
    return false;
  }
  return (
    typeof question.id === "string" &&
    typeof question.header === "string" &&
    typeof question.question === "string" &&
    typeof question.isOther === "boolean" &&
    typeof question.isSecret === "boolean" &&
    (question.options === null || Array.isArray(question.options))
  );
}

function parseManagedServerRequestFromEvent(event: NormalizedEvent): PendingServerRequest | null {
  if (!isManagedServerRequestMethod(event.kind)) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(event.payloadJson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse managed server request payload: ${reason}`);
  }

  const message = asObject(parsed);
  if (!message || typeof message.method !== "string") {
    throw new Error("Managed server request payload missing method");
  }
  if (!isManagedServerRequestMethod(message.method)) {
    throw new Error(`Managed server request method mismatch: ${String(message.method)}`);
  }
  if (!isRpcId(message.id)) {
    throw new Error("Managed server request payload missing valid JSON-RPC id");
  }
  const params = asObject(message.params);
  if (!params) {
    throw new Error("Managed server request payload missing params object");
  }
  if (typeof params.threadId !== "string" || typeof params.turnId !== "string") {
    throw new Error("Managed server request payload missing threadId/turnId");
  }

  const method = message.method;
  const itemId =
    typeof params.itemId === "string"
      ? params.itemId
      : method === "item/tool/call" && typeof params.callId === "string"
        ? params.callId
        : null;
  if (!itemId) {
    throw new Error(`Managed server request payload missing item id for ${method}`);
  }
  const reason = typeof params.reason === "string" ? params.reason : undefined;
  const questionsRaw = params.questions;
  let questions: ToolRequestUserInputQuestion[] | undefined;
  if (method === "item/tool/requestUserInput") {
    if (!Array.isArray(questionsRaw)) {
      throw new Error("Managed tool requestUserInput payload missing questions array");
    }
    if (!questionsRaw.every(isToolRequestUserInputQuestion)) {
      throw new Error("Managed tool requestUserInput payload has invalid question shape");
    }
    questions = questionsRaw;
  }

  return {
    requestId: message.id,
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

function isTurnScopedEvent(kind: string): boolean {
  return kind === "error" || TURN_SCOPED_EVENT_PREFIXES.some((prefix) => kind.startsWith(prefix));
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

function isChatgptAuthTokensRefreshRequest(
  message: ServerInboundMessage,
): message is {
  method: "account/chatgptAuthTokens/refresh";
  id: RpcId;
  params: ChatgptAuthTokensRefreshParams;
} {
  if (
    !("method" in message) ||
    message.method !== "account/chatgptAuthTokens/refresh" ||
    !("id" in message) ||
    (typeof message.id !== "number" && typeof message.id !== "string") ||
    !("params" in message)
  ) {
    return false;
  }
  const params = asObject(message.params);
  return !!params && typeof params.reason === "string";
}

function isResponse(message: ServerInboundMessage): message is CodexResponse {
  return "id" in message && !isServerNotification(message);
}

function parseTurnCompletedStatus(payloadJson: string): "completed" | "failed" | "cancelled" {
  const terminal = terminalStatusForPayload("turn/completed", payloadJson);
  if (!terminal) {
    throw new Error("turn/completed payload did not produce terminal status");
  }
  if (terminal.status === "failed") {
    return "failed";
  }
  if (terminal.status === "interrupted") {
    return "cancelled";
  }
  return "completed";
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
  let dispatchManaged: boolean | null = null;
  let nextRequestId = 1;
  let pendingDispatchTextQueue: string[] = [];
  let claimLoopRunning = false;
  const dispatchByTurnId = new Map<
    string,
    { dispatchId: string; claimToken: string; source: "runtime_queue" | "external_claim"; persistedTurnId: string }
  >();
  let activeDispatch:
    | {
        dispatchId: string;
        claimToken: string;
        turnId: string;
        text: string;
        source: "runtime_queue" | "external_claim";
      }
    | null = null;
  let startupModel: string | undefined;
  let startupCwd: string | undefined;

  let ingestQueue: IngestDelta[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTail: Promise<void> = Promise.resolve();
  let ingestFlushMs = 250;
  const pendingServerRequests = new Map<string, PendingServerRequest>();
  const pendingServerRequestRetries = new Map<string, PendingServerRequestRetryEntry>();
  let pendingServerRequestRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingAuthTokensRefreshRequests = new Map<string, PendingAuthTokensRefreshRequest>();
  const enqueuedByKind = new Map<string, number>();
  const skippedByKind = new Map<string, number>();
  let enqueuedEventCount = 0;
  let skippedEventCount = 0;
  let lastErrorCode: HostRuntimeErrorCode | null = null;
  let lastErrorMessage: string | null = null;

  const pendingRequests = new Map<number, PendingRequest>();

  const incrementCount = (counts: Map<string, number>, kind: string) => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  };

  const snapshotKindCounts = (counts: Map<string, number>): Array<{ kind: string; count: number }> =>
    Array.from(counts.entries())
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([kind, count]) => ({ kind, count }));

  const resetIngestMetrics = () => {
    enqueuedByKind.clear();
    skippedByKind.clear();
    enqueuedEventCount = 0;
    skippedEventCount = 0;
  };

  const emitState = (error?: { code: HostRuntimeErrorCode; message: string } | null) => {
    if (error === undefined) {
      // keep previous error state as-is
    } else if (error === null) {
      lastErrorCode = null;
      lastErrorMessage = null;
    } else {
      lastErrorCode = error.code;
      lastErrorMessage = `[${error.code}] ${error.message}`;
    }
    args.handlers?.onState?.({
      running: !!bridge,
      dispatchManaged,
      threadId,
      externalThreadId,
      turnId,
      turnInFlight,
      pendingServerRequestCount: pendingServerRequests.size,
      ingestMetrics: {
        enqueuedEventCount,
        skippedEventCount,
        enqueuedByKind: snapshotKindCounts(enqueuedByKind),
        skippedByKind: snapshotKindCounts(skippedByKind),
      },
      lastErrorCode,
      lastError: lastErrorMessage,
    });
  };

  const runtimeError = (code: HostRuntimeErrorCode, message: string): CodexHostRuntimeError => {
    const error = new CodexHostRuntimeError(code, message);
    emitState({ code, message });
    return error;
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

  const clearPendingServerRequestRetryTimer = () => {
    if (pendingServerRequestRetryTimer) {
      clearTimeout(pendingServerRequestRetryTimer);
      pendingServerRequestRetryTimer = null;
    }
  };

  const schedulePendingServerRequestRetry = () => {
    if (pendingServerRequestRetries.size === 0 || pendingServerRequestRetryTimer) {
      return;
    }
    pendingServerRequestRetryTimer = setTimeout(() => {
      pendingServerRequestRetryTimer = null;
      void flushPendingServerRequestRetries();
    }, PENDING_SERVER_REQUEST_RETRY_DELAY_MS);
  };

  const enqueuePendingServerRequestRetry = (request: PendingServerRequest, error: unknown) => {
    const key = toRequestKey(request.requestId);
    const existing = pendingServerRequestRetries.get(key);
    const reason = error instanceof Error ? error.message : String(error);
    if (existing) {
      pendingServerRequestRetries.set(key, {
        request,
        attempts: existing.attempts + 1,
        firstQueuedAt: existing.firstQueuedAt,
        lastError: reason,
      });
    } else {
      pendingServerRequestRetries.set(key, {
        request,
        attempts: 1,
        firstQueuedAt: Date.now(),
        lastError: reason,
      });
    }
    schedulePendingServerRequestRetry();
  };

  const flushPendingServerRequestRetries = async () => {
    if (!actor || pendingServerRequestRetries.size === 0) {
      return;
    }
    const nowMs = Date.now();
    for (const [key, entry] of pendingServerRequestRetries.entries()) {
      if (
        entry.attempts >= PENDING_SERVER_REQUEST_MAX_RETRIES ||
        nowMs - entry.firstQueuedAt >= PENDING_SERVER_REQUEST_RETRY_TTL_MS
      ) {
        pendingServerRequestRetries.delete(key);
        args.handlers?.onProtocolError?.({
          message:
            `Dropped pending server request after retry budget exhausted: requestId=${String(entry.request.requestId)} ` +
            `turnId=${entry.request.turnId} reason=${entry.lastError}`,
          line: entry.request.payloadJson,
        });
        continue;
      }
      try {
        await args.persistence.upsertPendingServerRequest({ actor, request: entry.request });
        pendingServerRequestRetries.delete(key);
      } catch (error) {
        if (isTurnNotFoundPersistenceError(error)) {
          pendingServerRequestRetries.set(key, {
            ...entry,
            attempts: entry.attempts + 1,
            lastError: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        pendingServerRequestRetries.delete(key);
        args.handlers?.onProtocolError?.({
          message: `Failed to persist pending server request: ${error instanceof Error ? error.message : String(error)}`,
          line: entry.request.payloadJson,
        });
      }
    }
    if (pendingServerRequestRetries.size > 0) {
      schedulePendingServerRequestRetry();
    }
  };

  const registerPendingServerRequest = async (request: PendingServerRequest) => {
    pendingServerRequests.set(toRequestKey(request.requestId), request);
    if (actor) {
      try {
        await args.persistence.upsertPendingServerRequest({ actor, request });
      } catch (error) {
        if (isTurnNotFoundPersistenceError(error)) {
          enqueuePendingServerRequestRetry(request, error);
        } else {
          throw error;
        }
      }
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
    pendingServerRequestRetries.delete(key);
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

  const registerPendingAuthTokensRefreshRequest = (request: PendingAuthTokensRefreshRequest): void => {
    pendingAuthTokensRefreshRequests.set(toRequestKey(request.requestId), request);
  };

  const getPendingAuthTokensRefreshRequest = (requestId: RpcId): PendingAuthTokensRefreshRequest => {
    const pending = pendingAuthTokensRefreshRequests.get(toRequestKey(requestId));
    if (!pending) {
      throw new Error(`No pending auth token refresh request found for id ${String(requestId)}`);
    }
    return pending;
  };

  const resolvePendingAuthTokensRefreshRequest = (requestId: RpcId): void => {
    pendingAuthTokensRefreshRequests.delete(toRequestKey(requestId));
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

  const ensureThreadBinding = async (preferredRuntimeThreadId?: string): Promise<void> => {
    if (!actor || !sessionId || threadId) {
      return;
    }
    const nextRuntimeThreadId = preferredRuntimeThreadId ?? runtimeThreadId;
    if (!nextRuntimeThreadId) {
      return;
    }
    const binding = await args.persistence.ensureThread({
      actor,
      externalThreadId: externalThreadId ?? nextRuntimeThreadId,
      ...(startupModel !== undefined ? { model: startupModel } : {}),
      ...(startupCwd !== undefined ? { cwd: startupCwd } : {}),
      localThreadId: nextRuntimeThreadId,
    });
    threadId = binding.threadId;
    externalThreadId = binding.externalThreadId ?? nextRuntimeThreadId;
    await args.persistence.ensureSession({
      actor,
      sessionId,
      threadId,
      lastEventCursor: 0,
    });
    emitState();
  };

  const sendClaimedDispatch = async (claimed: {
    dispatchId: string;
    turnId: string;
    idempotencyKey: string;
    inputText: string;
    claimToken: string;
    leaseExpiresAt: number;
    attemptCount: number;
    source: "runtime_queue" | "external_claim";
  }) => {
    if (!runtimeThreadId) {
      throw new Error("Cannot dispatch turn before runtime thread is ready.");
    }
    activeDispatch = {
      dispatchId: claimed.dispatchId,
      claimToken: claimed.claimToken,
      turnId: claimed.turnId,
      text: claimed.inputText,
      source: claimed.source,
    };
    turnId = claimed.turnId;
    turnInFlight = true;
    turnSettled = false;
    emitState();

    const reqId = requestId();
    pendingRequests.set(reqId, {
      method: "turn/start",
      dispatchId: claimed.dispatchId,
      claimToken: claimed.claimToken,
      turnId: claimed.turnId,
      dispatchSource: claimed.source,
    });
    assertRuntimeReady().send(
      buildTurnStartTextRequest(reqId, {
        threadId: runtimeThreadId,
        text: claimed.inputText,
      }),
    );
  };

  const processDispatchQueue = async (): Promise<void> => {
    if (dispatchManaged !== false) {
      return;
    }
    if (claimLoopRunning) {
      return;
    }
    claimLoopRunning = true;
    try {
      while (true) {
        if (!actor || !threadId) {
          return;
        }
        if (activeDispatch?.source === "external_claim") {
          return;
        }
        if (turnInFlight && !turnSettled) {
          return;
        }
        if (pendingDispatchTextQueue.length === 0) {
          return;
        }

        const nextText = pendingDispatchTextQueue[0];
        if (nextText === undefined) {
          return;
        }
        const enqueueResult = await args.persistence.enqueueTurnDispatch({
          actor,
          threadId,
          turnId: randomSessionId(),
          idempotencyKey: randomSessionId(),
          input: [{ type: "text", text: nextText }],
        });
        if (!enqueueResult.accepted) {
          pendingDispatchTextQueue.shift();
          continue;
        }
        const claimed = await args.persistence.claimNextTurnDispatch({
          actor,
          threadId,
          claimOwner: sessionId ?? "runtime-owner",
        });
        if (!claimed) {
          return;
        }
        pendingDispatchTextQueue.shift();
        try {
          await sendClaimedDispatch({
            ...claimed,
            source: "runtime_queue",
          });
        } catch (error) {
          if (actor && threadId) {
            await args.persistence.markTurnDispatchFailed({
              actor,
              threadId,
              dispatchId: claimed.dispatchId,
              claimToken: claimed.claimToken,
              code: "TURN_START_DISPATCH_SEND_FAILED",
              reason: error instanceof Error ? error.message : String(error),
            });
          }
          turnInFlight = false;
          turnSettled = true;
          turnId = null;
          activeDispatch = null;
          emitState();
          continue;
        }
        return;
      }
    } finally {
      claimLoopRunning = false;
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
        const normalizedBatch = normalizeInboundDeltas(batch).map((delta, index) => ({
          ...delta,
          threadId: batch[index]?.threadId ?? activeThreadId,
        }));
        const result = await args.persistence.ingestSafe({
          actor: activeActor,
          sessionId: activeSessionId,
          threadId: activeThreadId,
          deltas: normalizedBatch,
        });
        if (result.status === "rejected") {
          if (shouldDropRejectedIngestBatch(result.errors)) {
            continue;
          }
          throw new Error(`ingestSafe rejected: ${result.errors.map((err) => err.code).join(",")}`);
        }
      }
      await flushPendingServerRequestRetries();
    });

    flushTail = next.catch((error) => {
      const reason = error instanceof Error ? error.message : String(error);
      const coded = runtimeError("E_RUNTIME_INGEST_FLUSH_FAILED", `Failed to flush ingest queue: ${reason}`);
      args.handlers?.onProtocolError?.({
        message: coded.message,
        line: "[runtime:flushQueue]",
      });
    });
    await next;
  };

  const resolvePersistedTurnId = (runtimeTurnId?: string): string | null => {
    if (runtimeTurnId) {
      const mapped = dispatchByTurnId.get(runtimeTurnId)?.persistedTurnId;
      return mapped ?? runtimeTurnId;
    }
    return turnId;
  };

  const toCanonicalPendingServerRequest = (args: {
    request: PendingServerRequest;
    event: NormalizedEvent;
    persistedThreadId: string;
  }): PendingServerRequest => {
    const runtimeTurnId = args.event.turnId ?? args.request.turnId;
    const persistedTurnId = resolvePersistedTurnId(runtimeTurnId) ?? args.request.turnId;
    return {
      ...args.request,
      threadId: args.persistedThreadId,
      turnId: persistedTurnId,
      payloadJson: rewritePayloadTurnId({
        kind: args.event.kind,
        payloadJson: args.request.payloadJson,
        persistedTurnId,
        ...(runtimeTurnId ? { runtimeTurnId } : {}),
      }),
    };
  };

  const rewritePayloadTurnId = (args: {
    kind: string;
    payloadJson: string;
    runtimeTurnId?: string;
    persistedTurnId: string;
  }): string => {
    const { kind, payloadJson, runtimeTurnId, persistedTurnId } = args;
    if (!runtimeTurnId || runtimeTurnId === persistedTurnId) {
      return payloadJson;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadJson);
    } catch (error) {
      void error;
      return payloadJson;
    }
    const message = asObject(parsed);
    if (!message) {
      return payloadJson;
    }
    if (kind.startsWith("codex/event/")) {
      const params = asObject(message.params);
      const msg = params ? asObject(params.msg) : null;
      if (!msg) {
        return payloadJson;
      }
      if (typeof msg.turn_id === "string") {
        msg.turn_id = persistedTurnId;
      }
      if (typeof msg.turnId === "string") {
        msg.turnId = persistedTurnId;
      }
      return JSON.stringify(parsed);
    }
    const params = asObject(message.params);
    if (!params) {
      return payloadJson;
    }
    if (kind === "turn/started" || kind === "turn/completed") {
      const turn = asObject(params.turn);
      if (!turn || typeof turn.id !== "string") {
        return payloadJson;
      }
      turn.id = persistedTurnId;
      return JSON.stringify(parsed);
    }
    if (typeof params.turnId === "string") {
      params.turnId = persistedTurnId;
      return JSON.stringify(parsed);
    }
    if (typeof params.turn_id === "string") {
      params.turn_id = persistedTurnId;
      return JSON.stringify(parsed);
    }
    return payloadJson;
  };

  const toIngestDelta = (event: NormalizedEvent, persistedThreadId: string): IngestDelta | null => {
    const resolvedTurnId = resolvePersistedTurnId(event.turnId);
    if (!resolvedTurnId || !isTurnScopedEvent(event.kind)) {
      return null;
    }

    const rewrittenPayload = rewritePayloadTurnId({
      kind: event.kind,
      payloadJson: event.payloadJson,
      persistedTurnId: resolvedTurnId,
      ...(event.turnId ? { runtimeTurnId: event.turnId } : {}),
    });
    const resolvedStreamId =
      event.streamId && event.turnId && event.turnId !== resolvedTurnId
        ? event.streamId.replace(`:${event.turnId}:`, `:${resolvedTurnId}:`)
        : event.streamId;
    if (!resolvedStreamId) {
      throw new Error(`Protocol event missing streamId for turn-scoped kind: ${event.kind}`);
    }

    return {
      type: "stream_delta",
      eventId: event.eventId,
      kind: event.kind,
      payloadJson: rewrittenPayload,
      cursorStart: event.cursorStart,
      cursorEnd: event.cursorEnd,
      createdAt: event.createdAt,
      threadId: persistedThreadId,
      turnId: resolvedTurnId,
      streamId: resolvedStreamId,
    };
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
        void flushQueue().catch((error) => {
          const reason = error instanceof Error ? error.message : String(error);
          const coded = runtimeError("E_RUNTIME_INGEST_FLUSH_FAILED", `Deferred ingest flush failed: ${reason}`);
          args.handlers?.onProtocolError?.({
            message: coded.message,
            line: "[runtime:flushTimer]",
          });
        });
      }, turnInFlight ? ingestFlushMs : 5000);
    }
  };

  const start = async (startArgs: HostRuntimeStartArgs): Promise<void> => {
    if (bridge) {
      emitState();
      return;
    }
    if (typeof startArgs.dispatchManaged !== "boolean") {
      throw runtimeError(
        "E_RUNTIME_DISPATCH_MODE_REQUIRED",
        "start() requires dispatchManaged=true|false to make orchestration ownership explicit.",
      );
    }

    actor = startArgs.actor;
    dispatchManaged = startArgs.dispatchManaged;
    sessionId = startArgs.sessionId ? `${startArgs.sessionId}-${randomSessionId()}` : randomSessionId();
    externalThreadId = startArgs.externalThreadId ?? null;
    startupModel = startArgs.model;
    startupCwd = startArgs.cwd;
    ingestFlushMs = startArgs.ingestFlushMs ?? 250;
    resetIngestMetrics();
    emitState(null);

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
        try {
          if (!actor || !sessionId) {
            return;
          }

          if (
            !runtimeThreadId ||
            (!isUuidLikeThreadId(runtimeThreadId) && isUuidLikeThreadId(event.threadId))
          ) {
            runtimeThreadId = event.threadId;
          }

          await ensureThreadBinding(event.threadId);

          if (event.kind === "turn/started" && event.turnId) {
            const persistedTurnId = resolvePersistedTurnId(event.turnId) ?? event.turnId;
            turnId = persistedTurnId;
            turnInFlight = true;
            turnSettled = false;
            if (activeDispatch && actor && threadId) {
              dispatchByTurnId.set(event.turnId, {
                dispatchId: activeDispatch.dispatchId,
                claimToken: activeDispatch.claimToken,
                source: activeDispatch.source,
                persistedTurnId: activeDispatch.turnId,
              });
              await args.persistence.markTurnDispatchStarted({
                actor,
                threadId,
                dispatchId: activeDispatch.dispatchId,
                claimToken: activeDispatch.claimToken,
                ...(runtimeThreadId ? { runtimeThreadId } : {}),
                runtimeTurnId: event.turnId,
              });
              activeDispatch = null;
            }
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
            const terminal = parseTurnCompletedStatus(event.payloadJson);
            if (actor && threadId && event.turnId) {
              const dispatch = dispatchByTurnId.get(event.turnId);
              if (dispatch) {
                if (terminal === "completed") {
                  await args.persistence.markTurnDispatchCompleted({
                    actor,
                    threadId,
                    dispatchId: dispatch.dispatchId,
                    claimToken: dispatch.claimToken,
                  });
                } else if (terminal === "cancelled") {
                  await args.persistence.cancelTurnDispatch({
                    actor,
                    threadId,
                    dispatchId: dispatch.dispatchId,
                    claimToken: dispatch.claimToken,
                    reason: "interrupted",
                  });
                } else {
                  await args.persistence.markTurnDispatchFailed({
                    actor,
                    threadId,
                    dispatchId: dispatch.dispatchId,
                    claimToken: dispatch.claimToken,
                    code: "TURN_COMPLETED_FAILED",
                    reason: "turn/completed reported failed status",
                  });
                }
              }
            }
            turnId = null;
            turnInFlight = false;
            turnSettled = true;
            emitState();
            await expireTurnServerRequests({
              threadId: threadId ?? event.threadId,
              ...(event.turnId ? { turnId: event.turnId } : {}),
            });
            if (dispatchManaged === false) {
              await processDispatchQueue();
            }
          }
          if (event.kind === "error") {
            if (actor && threadId && event.turnId) {
              const dispatch = dispatchByTurnId.get(event.turnId);
              if (dispatch) {
                await args.persistence.markTurnDispatchFailed({
                  actor,
                  threadId,
                  dispatchId: dispatch.dispatchId,
                  claimToken: dispatch.claimToken,
                  code: "TURN_ERROR_EVENT",
                  reason: "Runtime emitted error event for turn",
                });
              }
            }
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
            if (dispatchManaged === false) {
              await processDispatchQueue();
            }
          }

          const pendingServerRequest = parseManagedServerRequestFromEvent(event);
          if (pendingServerRequest) {
            const persistedThreadId = threadId;
            if (persistedThreadId) {
              const canonicalPendingServerRequest = toCanonicalPendingServerRequest({
                request: pendingServerRequest,
                event,
                persistedThreadId,
              });
              await registerPendingServerRequest({
                ...canonicalPendingServerRequest,
              });
            }
          }

          if (event.kind === "thread/tokenUsage/updated" && args.persistence.upsertTokenUsage) {
            try {
              const persistedThreadId = threadId;
              if (persistedThreadId && actor) {
                let parsed: unknown;
                try {
                  parsed = JSON.parse(event.payloadJson);
                } catch (_parseError) {
                  parsed = null;
                }
                const envelope = asObject(parsed);
                const payload = envelope ? asObject(envelope.params) ?? envelope : null;
                const tokenUsage = payload ? asObject(payload.tokenUsage) : null;
                const resolvedTurnId = resolvePersistedTurnId(event.turnId) ?? turnId;
                if (tokenUsage && resolvedTurnId) {
                  const total = asObject(tokenUsage.total);
                  const last = asObject(tokenUsage.last);
                  const modelContextWindow =
                    typeof payload?.modelContextWindow === "number" ? payload.modelContextWindow : undefined;
                  await args.persistence.upsertTokenUsage({
                    actor,
                    threadId: persistedThreadId,
                    turnId: resolvedTurnId,
                    totalTokens: typeof total?.totalTokens === "number" ? total.totalTokens : 0,
                    inputTokens: typeof total?.inputTokens === "number" ? total.inputTokens : 0,
                    cachedInputTokens: typeof total?.cachedInputTokens === "number" ? total.cachedInputTokens : 0,
                    outputTokens: typeof total?.outputTokens === "number" ? total.outputTokens : 0,
                    reasoningOutputTokens: typeof total?.reasoningOutputTokens === "number" ? total.reasoningOutputTokens : 0,
                    lastTotalTokens: typeof last?.totalTokens === "number" ? last.totalTokens : 0,
                    lastInputTokens: typeof last?.inputTokens === "number" ? last.inputTokens : 0,
                    lastCachedInputTokens: typeof last?.cachedInputTokens === "number" ? last.cachedInputTokens : 0,
                    lastOutputTokens: typeof last?.outputTokens === "number" ? last.outputTokens : 0,
                    lastReasoningOutputTokens: typeof last?.reasoningOutputTokens === "number" ? last.reasoningOutputTokens : 0,
                    ...(modelContextWindow !== undefined ? { modelContextWindow } : {}),
                  });
                }
              }
            } catch (error) {
              const reason = error instanceof Error ? error.message : String(error);
              args.handlers?.onProtocolError?.({
                message: `Failed to persist token usage: ${reason}`,
                line: event.payloadJson,
              });
            }
          }

          args.handlers?.onEvent?.(event);

          const persistedThreadId = threadId;
          if (!persistedThreadId) {
            return;
          }

          const delta = toIngestDelta(event, persistedThreadId);
          if (!delta) {
            skippedEventCount += 1;
            incrementCount(skippedByKind, event.kind);
            return;
          }
          enqueuedEventCount += 1;
          incrementCount(enqueuedByKind, event.kind);

          const forceFlush =
            event.kind === "turn/completed" ||
            event.kind === "error";

          await enqueueIngestDelta(delta, forceFlush);
          await flushPendingServerRequestRetries();
          if (event.turnId && (event.kind === "turn/completed" || event.kind === "error")) {
            dispatchByTurnId.delete(event.turnId);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const coded = runtimeError(
            "E_RUNTIME_PROTOCOL_EVENT_INVALID",
            `Failed to process event "${event.kind}": ${reason}`,
          );
          args.handlers?.onProtocolError?.({
            message: coded.message,
            line: event.payloadJson,
          });
        }
      },
      onGlobalMessage: async (message) => {
          if (isChatgptAuthTokensRefreshRequest(message)) {
            registerPendingAuthTokensRefreshRequest({
              requestId: message.id,
              params: message.params,
              createdAt: Date.now(),
            });
          }

          if (isResponse(message) && typeof message.id === "number") {
            const pending = pendingRequests.get(message.id);
            pendingRequests.delete(message.id);
            if (pending) {
              setRuntimeThreadFromResponse(message, pending.method);
              if (pending.method === "thread/start" || pending.method === "thread/resume" || pending.method === "thread/fork") {
                await ensureThreadBinding(runtimeThreadId ?? undefined);
                if (dispatchManaged === false) {
                  await processDispatchQueue();
                }
              }
            }
            if (message.error && pending?.method === "turn/start") {
              if (actor && threadId && pending.dispatchId && pending.claimToken) {
                await args.persistence.markTurnDispatchFailed({
                  actor,
                  threadId,
                  dispatchId: pending.dispatchId,
                  claimToken: pending.claimToken,
                  code: typeof message.error.code === "number" ? String(message.error.code) : "TURN_START_FAILED",
                  reason: message.error.message,
                });
              }
              activeDispatch = null;
              turnInFlight = false;
              turnSettled = true;
              turnId = null;
              emitState();
              if (dispatchManaged === false) {
                await processDispatchQueue();
              }
            } else if (!message.error && pending?.method === "turn/start" && actor && threadId && pending.dispatchId && pending.claimToken) {
              const resultObj = typeof message.result === "object" && message.result !== null
                ? (message.result as Record<string, unknown>)
                : null;
              const turnObj = resultObj && typeof resultObj.turn === "object" && resultObj.turn !== null
                ? (resultObj.turn as Record<string, unknown>)
                : null;
              const runtimeTurnId = typeof turnObj?.id === "string" ? turnObj.id : pending.turnId;
              await args.persistence.markTurnDispatchStarted({
                actor,
                threadId,
                dispatchId: pending.dispatchId,
                claimToken: pending.claimToken,
                ...(runtimeThreadId ? { runtimeThreadId } : {}),
                ...(runtimeTurnId ? { runtimeTurnId } : {}),
              });
              if (runtimeTurnId) {
                dispatchByTurnId.set(runtimeTurnId, {
                  dispatchId: pending.dispatchId,
                  claimToken: pending.claimToken,
                  source: pending.dispatchSource ?? "runtime_queue",
                  persistedTurnId: pending.turnId ?? runtimeTurnId,
                });
              }
              activeDispatch = null;
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
        lastErrorCode = null;
        lastErrorMessage = message;
        emitState();
        args.handlers?.onProtocolError?.({ message, line });
      },
      onProcessExit: (code) => {
        lastErrorCode = null;
        lastErrorMessage = `codex exited with code ${String(code)}`;
        emitState();
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

    emitState(null);
  };

  const stop = async () => {
    clearFlushTimer();
    clearPendingServerRequestRetryTimer();
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
    dispatchManaged = null;
    pendingDispatchTextQueue = [];
    claimLoopRunning = false;
    dispatchByTurnId.clear();
    activeDispatch = null;
    startupModel = undefined;
    startupCwd = undefined;
    pendingRequests.clear();
    pendingServerRequests.clear();
    pendingServerRequestRetries.clear();
    pendingAuthTokensRefreshRequests.clear();
    resetIngestMetrics();
    emitState(null);
  };

  const sendTurn = (text: string) => {
    if (!bridge) {
      throw new Error("Bridge/thread not ready. Start runtime first.");
    }
    if (dispatchManaged !== false) {
      throw runtimeError(
        "E_RUNTIME_DISPATCH_MODE_CONFLICT",
        "sendTurn is only available when dispatchManaged=false.",
      );
    }
    if (activeDispatch?.source === "external_claim") {
      throw runtimeError(
        "E_RUNTIME_DISPATCH_EXTERNAL_CLAIM_ACTIVE",
        "Cannot enqueue runtime-managed turn while an external claimed dispatch is active.",
      );
    }
    if (turnInFlight && !turnSettled) {
      throw runtimeError(
        "E_RUNTIME_DISPATCH_TURN_IN_FLIGHT",
        "A turn is already in flight.",
      );
    }
    pendingDispatchTextQueue.push(text);
    void ensureThreadBinding(runtimeThreadId ?? undefined).then(() => processDispatchQueue());
  };

  // TODO(turn/steer): Route steer payloads through app-server `turn/steer` instead of forcing new turns.

  const startClaimedTurn = async (argsForClaimedTurn: {
    dispatchId: string;
    claimToken: string;
    turnId: string;
    inputText: string;
    idempotencyKey?: string;
  }): Promise<void> => {
    if (!bridge) {
      throw new Error("Bridge/thread not ready. Start runtime first.");
    }
    if (dispatchManaged !== true) {
      throw runtimeError(
        "E_RUNTIME_DISPATCH_MODE_CONFLICT",
        "startClaimedTurn is only available when dispatchManaged=true.",
      );
    }
    if (turnInFlight && !turnSettled) {
      throw runtimeError(
        "E_RUNTIME_DISPATCH_TURN_IN_FLIGHT",
        "A turn is already in flight.",
      );
    }
    if (
      !argsForClaimedTurn.dispatchId ||
      !argsForClaimedTurn.claimToken ||
      !argsForClaimedTurn.turnId ||
      !argsForClaimedTurn.inputText
    ) {
      throw runtimeError(
        "E_RUNTIME_DISPATCH_CLAIM_INVALID",
        "dispatchId, claimToken, turnId, and inputText are required for startClaimedTurn.",
      );
    }
    await ensureThreadBinding(runtimeThreadId ?? undefined);
    await sendClaimedDispatch({
      dispatchId: argsForClaimedTurn.dispatchId,
      claimToken: argsForClaimedTurn.claimToken,
      turnId: argsForClaimedTurn.turnId,
      inputText: argsForClaimedTurn.inputText,
      idempotencyKey: argsForClaimedTurn.idempotencyKey ?? randomSessionId(),
      leaseExpiresAt: Date.now() + 15_000,
      attemptCount: 1,
      source: "external_claim",
    });
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

  const readAccount = async (params?: { refreshToken?: boolean }): Promise<CodexResponse> =>
    sendRequest(buildAccountReadRequest(requestId(), params));

  const loginAccount = async (params: LoginAccountParams): Promise<CodexResponse> =>
    sendRequest(buildAccountLoginStartRequest(requestId(), params));

  const cancelAccountLogin = async (params: CancelLoginAccountParams): Promise<CodexResponse> =>
    sendRequest(buildAccountLoginCancelRequest(requestId(), params));

  const logoutAccount = async (): Promise<CodexResponse> =>
    sendRequest(buildAccountLogoutRequest(requestId()));

  const readAccountRateLimits = async (): Promise<CodexResponse> =>
    sendRequest(buildAccountRateLimitsReadRequest(requestId()));

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

  const respondChatgptAuthTokensRefresh = async (argsForTokens: {
    requestId: RpcId;
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType?: string | null;
  }): Promise<void> => {
    getPendingAuthTokensRefreshRequest(argsForTokens.requestId);
    const responseMessage = buildChatgptAuthTokensRefreshResponse(argsForTokens.requestId, {
      accessToken: argsForTokens.accessToken,
      chatgptAccountId: argsForTokens.chatgptAccountId,
      chatgptPlanType: argsForTokens.chatgptPlanType ?? null,
    });
    sendMessage(responseMessage);
    resolvePendingAuthTokensRefreshRequest(argsForTokens.requestId);
  };

  const getState = (): HostRuntimeState => ({
    running: !!bridge,
    dispatchManaged,
    threadId,
    externalThreadId,
    turnId,
    turnInFlight,
    pendingServerRequestCount: pendingServerRequests.size,
    ingestMetrics: {
      enqueuedEventCount,
      skippedEventCount,
      enqueuedByKind: snapshotKindCounts(enqueuedByKind),
      skippedByKind: snapshotKindCounts(skippedByKind),
    },
    lastErrorCode,
    lastError: lastErrorMessage,
  });

  return {
    start,
    stop,
    sendTurn,
    startClaimedTurn,
    interrupt,
    resumeThread,
    forkThread,
    archiveThread,
    unarchiveThread,
    rollbackThread,
    readThread,
    readAccount,
    loginAccount,
    cancelAccountLogin,
    logoutAccount,
    readAccountRateLimits,
    listThreads,
    listLoadedThreads,
    listPendingServerRequests,
    respondCommandApproval,
    respondFileChangeApproval,
    respondToolUserInput,
    respondDynamicToolCall,
    respondChatgptAuthTokensRefresh,
    getState,
  };
}
