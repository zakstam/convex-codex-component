/**
 * Shared types and error class for the CodexHostRuntime.
 * Pure type definitions — no runtime code.
 */
import type { CodexResponse, NormalizedEvent, ServerInboundMessage, RpcId } from "../protocol/generated.js";
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
import type { NewConversationParams } from "../protocol/schemas/NewConversationParams.js";
import type { ResumeConversationParams } from "../protocol/schemas/ResumeConversationParams.js";
import type { ListConversationsParams } from "../protocol/schemas/ListConversationsParams.js";
import type { ForkConversationParams } from "../protocol/schemas/ForkConversationParams.js";
import type { ArchiveConversationParams } from "../protocol/schemas/ArchiveConversationParams.js";
import type { InterruptConversationParams } from "../protocol/schemas/InterruptConversationParams.js";
import type { GetConversationSummaryParams } from "../protocol/schemas/GetConversationSummaryParams.js";
import type { CodexLocalBridge } from "../local-adapter/bridge.js";
import type { RuntimeThreadLocator, ThreadHandle } from "../shared/threadIdentity.js";

// ── Public types ──────────────────────────────────────────────────────

export type ActorContext = { userId?: string };

export type HostRuntimeLifecyclePhase = "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
export type HostRuntimeLifecycleSource = "runtime" | "bridge_event" | "protocol_error" | "process_exit";

export type HostRuntimeState = {
  running: boolean;
  phase: HostRuntimeLifecyclePhase;
  source: HostRuntimeLifecycleSource;
  updatedAtMs: number;
  persistedThreadId: string | null;
  runtimeThreadId: string | null;
  // Back-compat alias for consumers still reading `threadId`.
  threadId: string | null;
  threadHandle: string | null;
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
  | "E_RUNTIME_THREAD_NOT_OPEN"
  | "E_RUNTIME_DISPATCH_TURN_IN_FLIGHT"
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

export type HostRuntimeConnectArgs = {
  actor?: ActorContext;
  sessionId?: string;
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

export type HostRuntimeOpenThreadArgs = {
  strategy: "start" | "resume" | "fork";
  threadHandle?: ThreadHandle;
  model?: string;
  cwd?: string;
  dynamicTools?: DynamicToolSpec[];
};

export type HostRuntimeImportLocalThreadArgs = {
  runtimeThreadHandle: ThreadHandle;
  threadHandle?: ThreadHandle;
  sessionId?: string;
};

export type HostRuntimeImportLocalThreadResult = {
  threadHandle: string;
  threadId: string;
  importedTurnCount: number;
  importedMessageCount: number;
  syncState: "synced" | "partial";
  warnings: string[];
};

export type HostRuntimePersistence = {
  ensureThread: (args: {
    actor: ActorContext;
    threadHandle: string;
    model?: string;
    cwd?: string;
  }) => Promise<{ threadId: string; created?: boolean }>;
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
  acceptTurnSend: (args: {
    actor: ActorContext;
    threadId: string;
    inputText: string;
    idempotencyKey: string;
    dispatchId?: string;
    turnId: string;
  }) => Promise<{
    dispatchId: string;
    turnId: string;
    accepted: boolean;
  }>;
  failAcceptedTurnSend: (args: {
    actor: ActorContext;
    threadId: string;
    dispatchId: string;
    turnId: string;
    code?: string;
    reason: string;
  }) => Promise<void>;
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

export type HostRuntimeLifecycleListener = (state: HostRuntimeState) => void;

export type CodexHostRuntime = {
  connect: (args: HostRuntimeConnectArgs) => Promise<void>;
  openThread: (args: HostRuntimeOpenThreadArgs) => Promise<CodexResponse>;
  stop: () => Promise<void>;
  sendTurn: (text: string) => Promise<{ turnId: string; accepted: true }>;
  steerTurn: (text: string, options?: { expectedTurnId?: string }) => Promise<void>;
  interrupt: () => void;
  resumeThread: (
    threadHandle: RuntimeThreadLocator["runtimeThreadId"],
    params?: Omit<ThreadResumeParams, "threadId"> & { dynamicTools?: DynamicToolSpec[] },
  ) => Promise<CodexResponse>;
  forkThread: (
    threadHandle: RuntimeThreadLocator["runtimeThreadId"],
    params?: Omit<ThreadForkParams, "threadId">,
  ) => Promise<CodexResponse>;
  archiveThread: (threadHandle: RuntimeThreadLocator["runtimeThreadId"]) => Promise<CodexResponse>;
  setThreadName: (threadHandle: RuntimeThreadLocator["runtimeThreadId"], name: string) => Promise<CodexResponse>;
  unarchiveThread: (threadHandle: RuntimeThreadLocator["runtimeThreadId"]) => Promise<CodexResponse>;
  compactThread: (threadHandle: RuntimeThreadLocator["runtimeThreadId"]) => Promise<CodexResponse>;
  rollbackThread: (threadHandle: RuntimeThreadLocator["runtimeThreadId"], numTurns: number) => Promise<CodexResponse>;
  readThread: (
    threadHandle: RuntimeThreadLocator["runtimeThreadId"],
    includeTurns?: boolean,
  ) => Promise<CodexResponse>;
  importLocalThreadToPersistence: (
    args: HostRuntimeImportLocalThreadArgs,
  ) => Promise<HostRuntimeImportLocalThreadResult>;
  readAccount: (params?: { refreshToken?: boolean }) => Promise<CodexResponse>;
  loginAccount: (params: LoginAccountParams) => Promise<CodexResponse>;
  cancelAccountLogin: (params: CancelLoginAccountParams) => Promise<CodexResponse>;
  logoutAccount: () => Promise<CodexResponse>;
  readAccountRateLimits: () => Promise<CodexResponse>;
  listThreads: (params?: ThreadListParams) => Promise<CodexResponse>;
  listLoadedThreads: (params?: ThreadLoadedListParams) => Promise<CodexResponse>;
  newConversation: (params: NewConversationParams) => Promise<CodexResponse>;
  resumeConversation: (params: ResumeConversationParams) => Promise<CodexResponse>;
  listConversations: (params: ListConversationsParams) => Promise<CodexResponse>;
  forkConversation: (params: ForkConversationParams) => Promise<CodexResponse>;
  archiveConversation: (params: ArchiveConversationParams) => Promise<CodexResponse>;
  interruptConversation: (params: InterruptConversationParams) => Promise<CodexResponse>;
  getConversationSummary: (params: GetConversationSummaryParams) => Promise<CodexResponse>;
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
  getLifecycleState: () => HostRuntimeState;
  subscribeLifecycle: (listener: HostRuntimeLifecycleListener) => () => void;
};

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

// ── Internal types (shared across runtime modules) ───────────────────

export type StreamIngestDelta = {
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

export type LifecycleIngestEvent = {
  type: "lifecycle_event";
  eventId: string;
  kind: string;
  payloadJson: string;
  createdAt: number;
  threadId: string;
  turnId?: string;
};

export type IngestDelta = StreamIngestDelta | LifecycleIngestEvent;
export type ClientMessage = ClientOutboundWireMessage;
export type RequestMethod = ClientRequest["method"];
export type ClientRequestMessage = ClientRequest;
export type IngestSafeError = { code: string; message: string; recoverable: boolean };
export type ManagedServerRequestMethod =
  | "item/commandExecution/requestApproval"
  | "item/fileChange/requestApproval"
  | "item/tool/requestUserInput"
  | "item/tool/call";

export type PendingServerRequest = {
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

export type RuntimeServerRequestStatus = "pending" | "answered" | "expired";

export type PendingRequest = {
  method: string;
  dispatchId?: string;
  claimToken?: string;
  turnId?: string;
  resolve?: (message: CodexResponse) => void;
  reject?: (error: Error) => void;
};

export type PendingServerRequestRetryEntry = {
  request: PendingServerRequest;
  attempts: number;
  firstQueuedAt: number;
  lastError: string;
};

export type PendingAuthTokensRefreshRequest = {
  requestId: RpcId;
  params: ChatgptAuthTokensRefreshParams;
  createdAt: number;
};

export type RuntimeBridge = {
  start: () => void;
  stop: () => void;
  send: (message: ClientMessage) => void;
};

export type RuntimeBridgeHandlers = ConstructorParameters<typeof CodexLocalBridge>[1];
