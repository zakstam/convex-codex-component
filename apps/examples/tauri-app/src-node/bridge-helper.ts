import { ConvexHttpClient } from "convex/browser";
import {
  createCodexHostRuntime,
  createConvexPersistence,
  type CodexHostRuntime,
  type ConvexPersistenceChatApi,
} from "@zakstam/codex-local-component/host";
import {
  HELPER_ACK_BY_TYPE,
  parseHelperCommand,
  type ActorContext,
  type HelperCommand,
  type OpenThreadPayload,
  type StartPayload,
} from "@zakstam/codex-local-component/host/tauri";
import type {
  ServerInboundMessage,
  v2,
} from "@zakstam/codex-local-component/protocol";
import { api } from "../convex/_generated/api.js";
import {
  KNOWN_DYNAMIC_TOOLS,
  TAURI_RUNTIME_TOOL_NAME,
} from "../src/lib/dynamicTools.js";

type CommandExecutionApprovalDecision = v2.CommandExecutionApprovalDecision;
type FileChangeApprovalDecision = v2.FileChangeApprovalDecision;
type ToolRequestUserInputAnswer = v2.ToolRequestUserInputAnswer;
type DynamicToolSpec = v2.DynamicToolSpec;
type DynamicToolCallOutputContentItem = v2.DynamicToolCallOutputContentItem;
type LoginAccountParams = v2.LoginAccountParams;

type HelperEvent =
  | {
      type: "state";
      payload: {
        running: boolean;
        phase: "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
        source: "runtime" | "bridge_event" | "protocol_error" | "process_exit";
        updatedAtMs: number;
        conversationId: string | null;
        runtimeConversationId: string | null;
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
    }
  | { type: "event"; payload: { kind: string; threadId: string; turnId?: string; streamId?: string } }
  | { type: "global"; payload: Record<string, unknown> }
  | { type: "protocol_error"; payload: { message: string; line: string } }
  | { type: "ack"; payload: { command: string } }
  | { type: "error"; payload: { message: string } };

function isIgnorableProtocolNoise(message: string): boolean {
  return (
    message.includes(
      "Message is valid JSON-RPC but not a supported codex server notification/request/response shape.",
    ) || message.startsWith("[codex-bridge:raw-in] ")
  );
}

function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing generated Convex reference: ${name}`);
  }
  return value;
}

const chatApi = requireDefined(api.chat, "api.chat");

function randomSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emit(event: HelperEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function formatWiringValidationFailure(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return "Host wiring validation failed: unexpected result shape.";
  }
  const record = result as {
    ok?: unknown;
    checks?: Array<{ name?: unknown; ok?: unknown; error?: unknown }>;
  };
  const checks = Array.isArray(record.checks) ? record.checks : [];
  const failed = checks.filter((check) => check && check.ok === false);
  if (record.ok === true && failed.length === 0) {
    return "";
  }
  if (failed.length === 0) {
    return "Host wiring validation failed: one or more checks failed.";
  }
  const detail = failed
    .map((check) => {
      const name = typeof check.name === "string" ? check.name : "unknown";
      const error = typeof check.error === "string" ? check.error : "unknown error";
      return `${name}: ${error}`;
    })
    .join("; ");
  return `Host wiring validation failed: ${detail}`;
}


let runtime: CodexHostRuntime | null = null;
let convex: ConvexHttpClient | null = null;
let actor: ActorContext | null = null;
let activeSessionId: string | null = null;
let runtimeConversationId: string | null = null;
let startRuntimeOptions: {
  saveStreamDeltas: boolean;
  maxDeltasPerStreamRead: number;
  maxDeltasPerRequestRead: number;
  finishedStreamDeleteDelayMs: number;
} = {
  saveStreamDeltas: true,
  maxDeltasPerStreamRead: 100,
  maxDeltasPerRequestRead: 1000,
  finishedStreamDeleteDelayMs: 300000,
};

let bridgeState: {
  running: boolean;
  phase: "idle" | "starting" | "running" | "stopping" | "stopped" | "error";
  source: "runtime" | "bridge_event" | "protocol_error" | "process_exit";
  updatedAtMs: number;
  conversationId: string | null;
  runtimeConversationId: string | null;
  turnId: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  pendingServerRequestCount: number;
  ingestEnqueuedEventCount: number;
  ingestSkippedEventCount: number;
  ingestEnqueuedByKind: Array<{ kind: string; count: number }>;
  ingestSkippedByKind: Array<{ kind: string; count: number }>;
  disabledTools: string[];
} = {
  running: false,
  phase: "idle",
  source: "runtime",
  updatedAtMs: Date.now(),
  conversationId: null,
  runtimeConversationId: null,
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

let latestStartPayload: StartPayload | null = null;

const DYNAMIC_TOOLS: DynamicToolSpec[] = [
  {
    name: TAURI_RUNTIME_TOOL_NAME,
    description:
      "Return a local runtime snapshot from the Tauri host, including timestamp, runtime ids, and optional pending request summary.",
    inputSchema: {
      type: "object",
      properties: {
        includePendingRequests: {
          type: "boolean",
          description: "Whether to include pending request ids and methods for the current thread.",
        },
        note: {
          type: "string",
          description: "Optional user note to echo in the tool response.",
        },
      },
      additionalProperties: false,
    },
  },
];

const DYNAMIC_TOOL_NAMES = new Set<string>(KNOWN_DYNAMIC_TOOLS);

const inFlightDynamicToolCalls = new Set<string>();

function normalizeDisabledTools(tools: string[]): string[] {
  return [...new Set(tools.map((tool) => tool.trim()).filter((tool) => tool.length > 0))].sort();
}

function resolveEnabledDynamicTools(disabledTools: string[]): DynamicToolSpec[] {
  const disabled = new Set(disabledTools);
  return DYNAMIC_TOOLS.filter((tool) => !disabled.has(tool.name));
}

function emitState(next?: Partial<typeof bridgeState>): void {
  bridgeState = {
    ...bridgeState,
    ...(next ?? {}),
    updatedAtMs: Date.now(),
  };

  emit({
    type: "state",
    payload: {
      running: bridgeState.running,
      phase: bridgeState.phase,
      source: bridgeState.source,
      updatedAtMs: bridgeState.updatedAtMs,
      conversationId: bridgeState.conversationId,
      runtimeConversationId: bridgeState.runtimeConversationId,
      turnId: bridgeState.turnId,
      lastErrorCode: bridgeState.lastErrorCode,
      lastError: bridgeState.lastError,
      pendingServerRequestCount: bridgeState.pendingServerRequestCount,
      ingestEnqueuedEventCount: bridgeState.ingestEnqueuedEventCount,
      ingestSkippedEventCount: bridgeState.ingestSkippedEventCount,
      ingestEnqueuedByKind: bridgeState.ingestEnqueuedByKind,
      ingestSkippedByKind: bridgeState.ingestSkippedByKind,
      disabledTools: bridgeState.disabledTools,
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function dynamicToolCallKey(requestId: string | number): string {
  return `${typeof requestId}:${String(requestId)}`;
}

function parseDynamicToolCallRequest(payloadJson: string): {
  requestId: string | number;
  threadId: string;
  turnId: string;
  callId: string;
  tool: string;
  arguments: unknown;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }
  const root = asRecord(parsed);
  if (!root || root.method !== "item/tool/call") {
    return null;
  }
  const requestId = root.id;
  if (typeof requestId !== "string" && typeof requestId !== "number") {
    return null;
  }
  const params = asRecord(root.params);
  if (!params) {
    return null;
  }
  const threadId = typeof params.threadId === "string" ? params.threadId : null;
  const turnId = typeof params.turnId === "string" ? params.turnId : null;
  const callId = typeof params.callId === "string" ? params.callId : null;
  const tool = typeof params.tool === "string" ? params.tool : null;
  if (!threadId || !turnId || !callId || !tool) {
    return null;
  }
  return {
    requestId,
    threadId,
    turnId,
    callId,
    tool,
    arguments: params.arguments,
  };
}

async function executeDynamicToolCall(
  toolCall: ReturnType<typeof parseDynamicToolCallRequest> extends infer T
    ? Exclude<T, null>
    : never,
): Promise<{ success: boolean; contentItems: DynamicToolCallOutputContentItem[] }> {
  if (bridgeState.disabledTools.includes(toolCall.tool)) {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: `Dynamic tool disabled by policy: ${toolCall.tool}`,
        },
      ],
    };
  }

  if (toolCall.tool !== TAURI_RUNTIME_TOOL_NAME) {
    return {
      success: false,
      contentItems: [
        {
          type: "inputText",
          text: `Unknown dynamic tool: ${toolCall.tool}`,
        },
      ],
    };
  }

  const args = asRecord(toolCall.arguments) ?? {};
  const includePendingRequests = args.includePendingRequests === true;
  const note = typeof args.note === "string" ? args.note : null;

  let pendingSummary: Array<{ requestId: string | number; method: string }> = [];
  if (includePendingRequests && runtime) {
    const pending = await runtime.listPendingServerRequests();
    pendingSummary = pending.map((request) => ({
      requestId: request.requestId,
      method: request.method,
    }));
  }

  const snapshot = {
    tool: toolCall.tool,
    generatedAt: new Date().toISOString(),
    threadId: toolCall.threadId,
    conversationId: bridgeState.conversationId,
    runtimeConversationId: bridgeState.runtimeConversationId,
    turnId: toolCall.turnId,
    helperPid: process.pid,
    cwd: process.cwd(),
    ...(note ? { note } : {}),
    ...(includePendingRequests ? { pendingRequests: pendingSummary } : {}),
  };

  return {
    success: true,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify(snapshot, null, 2),
      },
    ],
  };
}

type OpenTargetResolution =
  | {
      mode: "bound";
      conversationHandle: string;
      runtimeThreadHandle: string;
    }
  | {
      mode: "unbound";
      conversationHandle: string;
      runtimeThreadHandle: string;
    };

function getThreadHandleFromCodexResponse(response: unknown): string | null {
  const root = asRecord(response);
  const result = asRecord(root?.result);
  const thread = asRecord(result?.thread);
  const threadId = typeof thread?.id === "string" ? thread.id : null;
  if (threadId && threadId.length > 0) {
    return threadId;
  }
  return null;
}

async function resolveOpenTarget(
  client: ConvexHttpClient,
  actor: ActorContext,
  conversationHandle: string,
): Promise<OpenTargetResolution> {
  const result = await client.query(
    requireDefined(chatApi.resolveOpenTarget, "api.chat.resolveOpenTarget"),
    { actor, conversationHandle },
  ) as OpenTargetResolution;
  return result;
}

async function runtimeHasLocalRolloutThreadHandle(conversationId: string): Promise<boolean> {
  if (!runtime) {
    return false;
  }
  let cursor: string | null = null;
  while (true) {
    const response = await runtime.listThreads(cursor ? { cursor } : undefined);
    const root = asRecord(response);
    const result = asRecord(root?.result);
    const data = Array.isArray(result?.data) ? result.data : [];
    for (const row of data) {
      const thread = asRecord(row);
      if (typeof thread?.id === "string" && thread.id === conversationId) {
        return true;
      }
    }
    const nextCursor = typeof result?.nextCursor === "string" ? result.nextCursor : null;
    if (!nextCursor) {
      break;
    }
    cursor = nextCursor;
  }
  return false;
}

async function setDisabledTools(tools: string[]): Promise<string[]> {
  const normalized = normalizeDisabledTools(tools).filter((tool) => DYNAMIC_TOOL_NAMES.has(tool));
  const unknown = tools
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0)
    .filter((tool) => !DYNAMIC_TOOL_NAMES.has(tool));
  if (unknown.length > 0) {
    const unknownToolNames = [...new Set(unknown)].sort();
    throw new Error(`Unknown dynamic tool name(s): ${unknownToolNames.join(", ")}`);
  }

  bridgeState = {
    ...bridgeState,
    disabledTools: normalized,
  };
  emitState();
  if (runtime && latestStartPayload) {
    const restartThreadHandle = bridgeState.runtimeConversationId ?? null;
    const restartPayload: StartPayload = {
      ...latestStartPayload,
      disabledTools: normalized,
    };
    await stopCurrentBridge();
    await startBridge(restartPayload);
    if (restartThreadHandle) {
      await openThread({
        strategy: "resume",
        conversationId: restartThreadHandle,
      });
    }
  }
  return normalized;
}

async function handlePendingDynamicToolCalls(threadId: string): Promise<void> {
  if (!runtime) {
    return;
  }

  try {
    // Pending server requests are stored against local Convex thread IDs.
    // Avoid filtering with runtime thread IDs (external IDs) to prevent false
    // "Thread not found for tenant" errors during dynamic tool dispatch.
    const pending = await runtime.listPendingServerRequests();
    for (const request of pending) {
      if (request.method !== "item/tool/call") {
        continue;
      }

      const key = dynamicToolCallKey(request.requestId);
      if (inFlightDynamicToolCalls.has(key)) {
        continue;
      }
      inFlightDynamicToolCalls.add(key);

      try {
        const parsed = parseDynamicToolCallRequest(request.payloadJson);
        if (!parsed) {
          await runtime.respondDynamicToolCall({
            requestId: request.requestId,
            success: false,
            contentItems: [{ type: "inputText", text: "Invalid dynamic tool call payload." }],
          });
          continue;
        }

        if (parsed.threadId !== threadId) {
          continue;
        }

        const result = await executeDynamicToolCall(parsed);
        await runtime.respondDynamicToolCall({
          requestId: request.requestId,
          success: result.success,
          contentItems: result.contentItems,
        });

        emit({
          type: "global",
          payload: {
            kind: "dynamic_tool/executed",
            tool: parsed.tool,
            threadId: parsed.threadId,
            turnId: parsed.turnId,
            callId: parsed.callId,
            success: result.success,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (runtime) {
          await runtime.respondDynamicToolCall({
            requestId: request.requestId,
            success: false,
            contentItems: [{ type: "inputText", text: message }],
          });
        }
      } finally {
        inFlightDynamicToolCalls.delete(key);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "protocol_error", payload: { message, line: "handlePendingDynamicToolCalls" } });
  }
}

async function emitLoadedRuntimeThreadsSnapshot(source: "start" | "open_thread"): Promise<void> {
  if (!runtime) {
    return;
  }
  const untitledPreview = "Untitled thread";
  const threadIds: string[] = [];
  const threads: Array<{ threadId: string; preview: string }> = [];
  const seen = new Set<string>();
  let cursor: string | null = null;

  while (true) {
    const response = await runtime.listThreads(cursor ? { cursor } : undefined);
    const root = asRecord(response);
    const result = asRecord(root?.result);
    const data = Array.isArray(result?.data) ? result.data : [];
    for (const row of data) {
      const thread = asRecord(row);
      const id = typeof thread?.id === "string" ? thread.id : null;
      if (!id) {
        continue;
      }
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      threadIds.push(id);
      const previewRaw = typeof thread?.preview === "string" ? thread.preview.trim() : "";
      threads.push({
        threadId: id,
        preview: previewRaw.length > 0 ? previewRaw : untitledPreview,
      });
    }
    const nextCursor = result?.nextCursor;
    if (typeof nextCursor !== "string" || nextCursor.length === 0) {
      break;
    }
    cursor = nextCursor;
  }

  emit({
    type: "global",
    payload: {
      kind: "bridge/local_threads_loaded",
      source,
      threadIds,
      threads,
    },
  });
}

async function startBridge(payload: StartPayload): Promise<void> {
  const normalizedPayload = {
    ...payload,
    disabledTools: normalizeDisabledTools(payload.disabledTools ?? []),
  };
  latestStartPayload = normalizedPayload;
  if (runtime) {
    bridgeState = {
      ...bridgeState,
      disabledTools: normalizedPayload.disabledTools,
    };
    emitState();
    emit({ type: "ack", payload: { command: "start" } });
    return;
  }

  convex = new ConvexHttpClient(payload.convexUrl);
  actor = payload.actor;
  activeSessionId = payload.sessionId ? `${payload.sessionId}-${randomSessionId()}` : randomSessionId();
  runtimeConversationId = null;

  const wiringValidation = await convex.query(
    requireDefined(chatApi.validateHostWiring, "api.chat.validateHostWiring"),
    { actor },
  );
  const wiringFailure = formatWiringValidationFailure(wiringValidation);
  if (wiringFailure) {
    throw new Error(wiringFailure);
  }

  startRuntimeOptions = {
    saveStreamDeltas: payload.saveStreamDeltas ?? true,
    maxDeltasPerStreamRead: 100,
    maxDeltasPerRequestRead: 1000,
    finishedStreamDeleteDelayMs: 300000,
  };

  runtime = createCodexHostRuntime({
    bridge: {
      cwd: payload.cwd ?? process.cwd(),
    },
    persistence: createConvexPersistence(
      convex,
      chatApi as unknown as ConvexPersistenceChatApi,
      {
        runtimeOptions: startRuntimeOptions,
        onSessionRollover: ({ threadId, errors }) => {
          emit({
            type: "global",
            payload: {
              kind: "sync/session_rolled_over",
              reason: "recoverable_rejected_status",
              threadId,
              errors,
            },
          });
        },
      },
    ),
    handlers: {
      onState: (state) => {
        emitState({
          running: state.running,
          phase: state.phase,
          source: state.source,
          updatedAtMs: state.updatedAtMs,
          conversationId: state.conversationId,
          runtimeConversationId: state.runtimeConversationId,
          turnId: state.turnId,
          lastErrorCode: state.lastErrorCode,
          lastError: state.lastError,
          pendingServerRequestCount: state.pendingServerRequestCount,
          ingestEnqueuedEventCount: state.ingestMetrics.enqueuedEventCount,
          ingestSkippedEventCount: state.ingestMetrics.skippedEventCount,
          ingestEnqueuedByKind: state.ingestMetrics.enqueuedByKind,
          ingestSkippedByKind: state.ingestMetrics.skippedByKind,
        });
      },
      onEvent: (event) => {
        runtimeConversationId = event.threadId;
        emitState({ runtimeConversationId: event.threadId });
        if (event.kind === "item/tool/call") {
          void handlePendingDynamicToolCalls(event.threadId);
        }
        emit({
          type: "event",
          payload: {
            kind: event.kind,
            threadId: event.threadId,
            ...(event.turnId ? { turnId: event.turnId } : {}),
            ...(event.streamId ? { streamId: event.streamId } : {}),
          },
        });
      },
      onGlobalMessage: (message: ServerInboundMessage) => {
        const asRecord = message as unknown;
        if (typeof asRecord === "object" && asRecord !== null) {
          const possibleError = (asRecord as { error?: { message?: unknown } }).error;
          if (possibleError && typeof possibleError.message === "string") {
            emitState({ lastErrorCode: null, lastError: possibleError.message });
            emit({
              type: "protocol_error",
              payload: {
                message: possibleError.message,
                line: JSON.stringify(asRecord),
              },
            });
          }
          emit({ type: "global", payload: asRecord as Record<string, unknown> });
        }
      },
      onProtocolError: ({ message, line }) => {
        if (isIgnorableProtocolNoise(message)) {
          const rawPrefix = "[codex-bridge:raw-in] ";
          if (message.startsWith(rawPrefix)) {
            emit({
              type: "global",
              payload: {
                kind: "protocol/raw_in",
                line: message.slice(rawPrefix.length),
              },
            });
            return;
          }
          emit({
            type: "global",
            payload: {
              kind: "protocol/ignored_message",
              reason: message,
              line,
            },
          });
          return;
        }
        emitState({ lastErrorCode: null, lastError: message });
        emit({ type: "protocol_error", payload: { message, line } });
      },
    },
  });

  try {
    const enabledDynamicTools = resolveEnabledDynamicTools(normalizedPayload.disabledTools);
    await runtime.connect({
      actor: payload.actor,
      sessionId: activeSessionId,
      dynamicTools: enabledDynamicTools,
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      ...(payload.deltaThrottleMs ? { ingestFlushMs: payload.deltaThrottleMs } : {}),
      runtime: startRuntimeOptions,
    });

    emitState({ running: true, phase: "running", source: "runtime", lastErrorCode: null, lastError: null });
    try {
      await emitLoadedRuntimeThreadsSnapshot("start");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        type: "global",
        payload: {
          kind: "bridge/local_threads_load_failed",
          source: "start",
          message,
        },
      });
    }
    emit({ type: "ack", payload: { command: "start" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitState({ running: false, phase: "error", source: "runtime", lastErrorCode: null, lastError: message });
    runtime = null;
    throw error;
  }
}

async function openThread(payload: OpenThreadPayload): Promise<void> {
  if (!runtime || !convex || !actor) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  let runtimeConversationIdForOpen: string | undefined;
  let resolvedUnboundTarget: { conversationHandle: string; runtimeThreadHandle: string } | null = null;
  if (payload.strategy === "resume" || payload.strategy === "fork") {
    const conversationHandle = payload.conversationId?.trim();
    if (!conversationHandle) {
      throw new Error(`conversationId is required when strategy="${payload.strategy}".`);
    }
    const resolved = await resolveOpenTarget(
      convex,
      actor,
      conversationHandle,
    );
    const canResumeLocally = await runtimeHasLocalRolloutThreadHandle(resolved.runtimeThreadHandle);
    if (canResumeLocally) {
      runtimeConversationIdForOpen = resolved.runtimeThreadHandle;
      if (payload.strategy === "resume" && resolved.mode === "unbound") {
        resolvedUnboundTarget = {
          conversationHandle: resolved.conversationHandle,
          runtimeThreadHandle: resolved.runtimeThreadHandle,
        };
      }
    } else if (payload.strategy === "resume" && resolved.mode === "bound") {
      const started = await runtime.openThread({
        strategy: "start",
        ...(payload.model ? { model: payload.model } : {}),
        ...(payload.cwd ? { cwd: payload.cwd } : {}),
        ...(payload.dynamicTools ? { dynamicTools: payload.dynamicTools } : {}),
      });
      const startedRuntimeThreadHandle =
        getThreadHandleFromCodexResponse(started) ??
        runtimeConversationId ??
        null;
      if (!startedRuntimeThreadHandle) {
        throw new Error("[E_OPEN_TARGET_RESOLUTION_FAILED] Could not determine runtime thread handle during rebind.");
      }
      await convex.mutation(
        requireDefined(chatApi.syncOpenConversationBinding, "api.chat.syncOpenConversationBinding"),
        {
          actor,
          conversationId: resolved.conversationHandle,
          runtimeConversationId: startedRuntimeThreadHandle,
          ...(payload.model ? { model: payload.model } : {}),
          ...(payload.cwd ? { cwd: payload.cwd } : {}),
          ...(activeSessionId ? { sessionId: activeSessionId } : {}),
        },
      );
      try {
        await emitLoadedRuntimeThreadsSnapshot("open_thread");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({
          type: "global",
          payload: {
            kind: "bridge/local_threads_load_failed",
            source: "open_thread",
            message,
          },
        });
      }
      return;
    } else {
      throw new Error(`[E_OPEN_TARGET_NOT_FOUND] No local rollout found for conversation handle: ${conversationHandle}`);
    }
  }
  await runtime.openThread({
    strategy: payload.strategy,
    ...(runtimeConversationIdForOpen ? { conversationId: runtimeConversationIdForOpen } : {}),
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.cwd ? { cwd: payload.cwd } : {}),
    ...(payload.dynamicTools ? { dynamicTools: payload.dynamicTools } : {}),
  });
  if (resolvedUnboundTarget) {
    try {
      await runtime.importLocalThreadToPersistence({
        runtimeThreadHandle: resolvedUnboundTarget.runtimeThreadHandle,
        conversationId: resolvedUnboundTarget.conversationHandle,
      });
      emit({
        type: "global",
        payload: {
          kind: "bridge/local_thread_synced",
          conversationId: resolvedUnboundTarget.conversationHandle,
          runtimeThreadHandle: resolvedUnboundTarget.runtimeThreadHandle,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit({
        type: "global",
        payload: {
          kind: "bridge/local_thread_sync_failed",
          conversationId: resolvedUnboundTarget.conversationHandle,
          runtimeThreadHandle: resolvedUnboundTarget.runtimeThreadHandle,
          message,
        },
      });
      throw error;
    }
  }
  try {
    await emitLoadedRuntimeThreadsSnapshot("open_thread");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({
      type: "global",
      payload: {
        kind: "bridge/local_threads_load_failed",
        source: "open_thread",
        message,
      },
    });
  }
}

async function refreshLocalThreads(): Promise<void> {
  await emitLoadedRuntimeThreadsSnapshot("open_thread");
}

async function sendTurn(text: string): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  await runtime.sendTurn(text);
}

function interruptCurrentTurn(): void {
  runtime?.interrupt();
}

async function respondCommandApproval(requestId: string | number, decision: CommandExecutionApprovalDecision): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  await runtime.respondCommandApproval({ requestId, decision });
}

async function respondFileChangeApproval(requestId: string | number, decision: FileChangeApprovalDecision): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  await runtime.respondFileChangeApproval({ requestId, decision });
}

async function respondToolUserInput(
  requestId: string | number,
  answers: Record<string, ToolRequestUserInputAnswer>,
): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  await runtime.respondToolUserInput({ requestId, answers });
}

async function readAccount(refreshToken?: boolean): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  const response = await runtime.readAccount({ refreshToken: refreshToken ?? false });
  emit({ type: "global", payload: { kind: "account/read_result", response } });
}

async function loginAccount(params: LoginAccountParams): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  const response = await runtime.loginAccount(params);
  emit({ type: "global", payload: { kind: "account/login_start_result", response } });
}

async function cancelAccountLogin(loginId: string): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  const response = await runtime.cancelAccountLogin({ loginId });
  emit({ type: "global", payload: { kind: "account/login_cancel_result", response } });
}

async function logoutAccount(): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  const response = await runtime.logoutAccount();
  emit({ type: "global", payload: { kind: "account/logout_result", response } });
}

async function readAccountRateLimits(): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  const response = await runtime.readAccountRateLimits();
  emit({ type: "global", payload: { kind: "account/rate_limits_read_result", response } });
}

async function respondChatgptAuthTokensRefresh(args: {
  requestId: string | number;
  accessToken: string;
  chatgptAccountId: string;
  chatgptPlanType?: string | null;
}): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  await runtime.respondChatgptAuthTokensRefresh({
    requestId: args.requestId,
    accessToken: args.accessToken,
    chatgptAccountId: args.chatgptAccountId,
    ...(args.chatgptPlanType !== undefined ? { chatgptPlanType: args.chatgptPlanType } : {}),
  });
}

async function stopCurrentBridge(): Promise<void> {
  try {
    if (runtime) {
      await runtime.stop();
    }
  } finally {
    runtime = null;
    convex = null;
    actor = null;
    activeSessionId = null;
    runtimeConversationId = null;
    emitState({
      running: false,
      phase: "stopped",
      source: "runtime",
      conversationId: null,
      runtimeConversationId: null,
      turnId: null,
      lastErrorCode: null,
      lastError: null,
      pendingServerRequestCount: 0,
      ingestEnqueuedEventCount: 0,
      ingestSkippedEventCount: 0,
      ingestEnqueuedByKind: [],
      ingestSkippedByKind: [],
    });
  }
}

let shutdownPromise: Promise<void> | null = null;

function gracefulShutdown(reason: string, opts?: { exitCode?: number; emitAckCommand?: string }): Promise<void> {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    let exitCode = opts?.exitCode ?? 0;
    try {
      await stopCurrentBridge();
      if (opts?.emitAckCommand) {
        emit({ type: "ack", payload: { command: opts.emitAckCommand } });
      }
    } catch (error) {
      exitCode = 1;
      const message = error instanceof Error ? error.message : String(error);
      emit({ type: "error", payload: { message: `shutdown failed (${reason}): ${message}` } });
    } finally {
      setImmediate(() => {
        process.exit(exitCode);
      });
    }
  })();

  return shutdownPromise;
}

async function handle(command: HelperCommand): Promise<void> {
  const handlers: {
    [K in HelperCommand["type"]]: (input: Extract<HelperCommand, { type: K }>) => Promise<void> | void;
  } = {
    start: (input) => startBridge(input.payload),
    open_thread: (input) => openThread(input.payload),
    refresh_local_threads: () => refreshLocalThreads(),
    send_turn: (input) => sendTurn(input.payload.text),
    respond_command_approval: (input) =>
      respondCommandApproval(input.payload.requestId, input.payload.decision),
    respond_file_change_approval: (input) =>
      respondFileChangeApproval(input.payload.requestId, input.payload.decision),
    respond_tool_user_input: (input) =>
      respondToolUserInput(input.payload.requestId, input.payload.answers),
    account_read: (input) => readAccount(input.payload.refreshToken),
    account_login_start: (input) => loginAccount(input.payload.params),
    account_login_cancel: (input) => cancelAccountLogin(input.payload.loginId),
    account_logout: () => logoutAccount(),
    account_rate_limits_read: () => readAccountRateLimits(),
    respond_chatgpt_auth_tokens_refresh: (input) => respondChatgptAuthTokensRefresh(input.payload),
    set_disabled_tools: async (input) => {
      await setDisabledTools(input.payload.tools);
    },
    interrupt: () => interruptCurrentTurn(),
    stop: () => gracefulShutdown("stop", { emitAckCommand: "stop" }),
    status: () => emitState(),
  };

  const handler = handlers[command.type] as (input: HelperCommand) => Promise<void> | void;
  await handler(command);

  if (HELPER_ACK_BY_TYPE[command.type]) {
    emit({ type: "ack", payload: { command: command.type } });
  }
}

let buffered = "";
let commandQueue: Promise<void> = Promise.resolve();

function enqueueCommand(command: HelperCommand): void {
  const run = async () => {
    try {
      await handle(command);
    } catch (error) {
      emit({ type: "error", payload: { message: error instanceof Error ? error.message : String(error) } });
    }
  };
  commandQueue = commandQueue.then(run, run);
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += String(chunk);
  while (true) {
    const idx = buffered.indexOf("\n");
    if (idx === -1) {
      break;
    }
    const line = buffered.slice(0, idx).trim();
    buffered = buffered.slice(idx + 1);
    if (!line) {
      continue;
    }
    try {
      const command = parseHelperCommand(line);
      enqueueCommand(command);
    } catch (error) {
      emit({ type: "error", payload: { message: error instanceof Error ? error.message : String(error) } });
    }
  }
});

process.stdin.resume();
process.stdin.on("end", () => {
  void gracefulShutdown("stdin-end");
});
process.stdin.on("close", () => {
  void gracefulShutdown("stdin-close");
});

process.on("SIGINT", () => {
  void gracefulShutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void gracefulShutdown("SIGTERM");
});

process.on("unhandledRejection", (reason) => {
  const message = reason instanceof Error ? reason.stack ?? reason.message : String(reason);
  emit({ type: "error", payload: { message: `Unhandled rejection: ${message}` } });
  emit({ type: "protocol_error", payload: { message: String(message), line: "unhandledRejection" } });
});

process.on("uncaughtException", (error) => {
  const message = error.stack ?? error.message;
  emit({ type: "error", payload: { message: `Uncaught exception: ${message}` } });
  emit({ type: "protocol_error", payload: { message, line: "uncaughtException" } });
});
