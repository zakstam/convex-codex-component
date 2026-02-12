import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import {
  createCodexHostRuntime,
  hasRecoverableIngestErrors,
  type CodexHostRuntime,
} from "@zakstam/codex-local-component/host";
import type {
  ServerInboundMessage,
  v2,
} from "@zakstam/codex-local-component/protocol";
import { api } from "../convex/_generated/api.js";

type CommandExecutionApprovalDecision = v2.CommandExecutionApprovalDecision;
type FileChangeApprovalDecision = v2.FileChangeApprovalDecision;
type ToolRequestUserInputAnswer = v2.ToolRequestUserInputAnswer;
type DynamicToolSpec = v2.DynamicToolSpec;
type DynamicToolCallOutputContentItem = v2.DynamicToolCallOutputContentItem;
type LoginAccountParams = v2.LoginAccountParams;

type ActorContext = { userId?: string };
type StartPayload = {
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
};

type HelperCommand =
  | { type: "start"; payload: StartPayload }
  | { type: "send_turn"; payload: { text: string } }
  | { type: "respond_command_approval"; payload: { requestId: string | number; decision: CommandExecutionApprovalDecision } }
  | { type: "respond_file_change_approval"; payload: { requestId: string | number; decision: FileChangeApprovalDecision } }
  | { type: "respond_tool_user_input"; payload: { requestId: string | number; answers: Record<string, ToolRequestUserInputAnswer> } }
  | { type: "account_read"; payload: { refreshToken?: boolean } }
  | { type: "account_login_start"; payload: { params: LoginAccountParams } }
  | { type: "account_login_cancel"; payload: { loginId: string } }
  | { type: "account_logout"; payload: Record<string, never> }
  | { type: "account_rate_limits_read"; payload: Record<string, never> }
  | {
      type: "respond_chatgpt_auth_tokens_refresh";
      payload: { requestId: string | number; idToken: string; accessToken: string };
    }
  | { type: "interrupt" }
  | { type: "stop" }
  | { type: "status" };

type HelperEvent =
  | {
      type: "state";
      payload: {
        running: boolean;
        localThreadId: string | null;
        turnId: string | null;
        lastErrorCode: string | null;
        lastError: string | null;
        runtimeThreadId: string | null;
        pendingServerRequestCount: number;
        ingestEnqueuedEventCount: number;
        ingestSkippedEventCount: number;
        ingestEnqueuedByKind: Array<{ kind: string; count: number }>;
        ingestSkippedByKind: Array<{ kind: string; count: number }>;
      };
    }
  | { type: "event"; payload: { kind: string; threadId: string; turnId?: string; streamId?: string } }
  | { type: "global"; payload: Record<string, unknown> }
  | { type: "protocol_error"; payload: { message: string; line: string } }
  | { type: "ack"; payload: { command: string } }
  | { type: "error"; payload: { message: string } };

function isIgnorableProtocolNoise(message: string): boolean {
  return message.includes(
    "Message is valid JSON-RPC but not a supported codex server notification/request/response shape.",
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

function toErrorCode(value: unknown): string {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }
  return value;
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

type IngestBatchError = {
  code: unknown;
  message: string;
  recoverable: boolean;
};

function mapIngestErrors(errors: IngestBatchError[]): Array<{
  code: string;
  message: string;
  recoverable: boolean;
}> {
  return errors.map((ingestError: IngestBatchError) => ({
    code: toErrorCode(ingestError.code),
    message: ingestError.message,
    recoverable: ingestError.recoverable,
  }));
}

function mapIngestErrorCodes(errors: IngestBatchError[]): Array<{
  code: string;
  message: string;
}> {
  return errors.map((ingestError: IngestBatchError) => ({
    code: toErrorCode(ingestError.code),
    message: ingestError.message,
  }));
}

let runtime: CodexHostRuntime | null = null;
let convex: ConvexHttpClient | null = null;
let actor: ActorContext | null = null;
let activeSessionId: string | null = null;
let runtimeThreadId: string | null = null;
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
  localThreadId: string | null;
  turnId: string | null;
  lastErrorCode: string | null;
  lastError: string | null;
  pendingServerRequestCount: number;
  ingestEnqueuedEventCount: number;
  ingestSkippedEventCount: number;
  ingestEnqueuedByKind: Array<{ kind: string; count: number }>;
  ingestSkippedByKind: Array<{ kind: string; count: number }>;
} = {
  running: false,
  localThreadId: null,
  turnId: null,
  lastErrorCode: null,
  lastError: null,
  pendingServerRequestCount: 0,
  ingestEnqueuedEventCount: 0,
  ingestSkippedEventCount: 0,
  ingestEnqueuedByKind: [],
  ingestSkippedByKind: [],
};

const DYNAMIC_TOOLS: DynamicToolSpec[] = [
  {
    name: "tauri_get_runtime_snapshot",
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

const inFlightDynamicToolCalls = new Set<string>();
let claimLoopRunning = false;
const helperClaimOwner = `tauri-helper-owner-${process.pid}`;

function emitState(next?: Partial<typeof bridgeState>): void {
  bridgeState = {
    ...bridgeState,
    ...(next ?? {}),
  };

  emit({
    type: "state",
    payload: {
      running: bridgeState.running,
      localThreadId: bridgeState.localThreadId,
      turnId: bridgeState.turnId,
      lastErrorCode: bridgeState.lastErrorCode,
      lastError: bridgeState.lastError,
      runtimeThreadId,
      pendingServerRequestCount: bridgeState.pendingServerRequestCount,
      ingestEnqueuedEventCount: bridgeState.ingestEnqueuedEventCount,
      ingestSkippedEventCount: bridgeState.ingestSkippedEventCount,
      ingestEnqueuedByKind: bridgeState.ingestEnqueuedByKind,
      ingestSkippedByKind: bridgeState.ingestSkippedByKind,
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

async function drainClaimedDispatches(): Promise<void> {
  if (claimLoopRunning || !runtime || !convex || !actor || !bridgeState.localThreadId) {
    return;
  }
  claimLoopRunning = true;
  try {
    while (runtime && convex && actor && bridgeState.localThreadId) {
      if (runtime.getState().turnInFlight) {
        return;
      }
      const claimed = await convex.mutation(
        requireDefined(chatApi.claimNextTurnDispatch, "api.chat.claimNextTurnDispatch"),
        {
          actor,
          threadId: bridgeState.localThreadId,
          claimOwner: helperClaimOwner,
        },
      );
      if (!claimed) {
        return;
      }
      await runtime.startClaimedTurn({
        dispatchId: claimed.dispatchId,
        claimToken: claimed.claimToken,
        turnId: claimed.turnId,
        inputText: claimed.inputText,
        idempotencyKey: claimed.idempotencyKey,
      });
      return;
    }
  } finally {
    claimLoopRunning = false;
  }
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
  if (toolCall.tool !== "tauri_get_runtime_snapshot") {
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
    const pending = bridgeState.localThreadId
      ? await runtime.listPendingServerRequests(bridgeState.localThreadId)
      : await runtime.listPendingServerRequests();
    pendingSummary = pending.map((request) => ({
      requestId: request.requestId,
      method: request.method,
    }));
  }

  const snapshot = {
    tool: toolCall.tool,
    generatedAt: new Date().toISOString(),
    threadId: toolCall.threadId,
    localThreadId: bridgeState.localThreadId,
    turnId: toolCall.turnId,
    runtimeThreadId,
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

async function startBridge(payload: StartPayload): Promise<void> {
  if (runtime) {
    emitState();
    emit({ type: "ack", payload: { command: "start" } });
    return;
  }

  convex = new ConvexHttpClient(payload.convexUrl);
  actor = payload.actor;
  activeSessionId = payload.sessionId ? `${payload.sessionId}-${randomSessionId()}` : randomSessionId();
  runtimeThreadId = payload.runtimeThreadId ?? null;

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
    persistence: {
      ensureThread: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        return convex.mutation(requireDefined(chatApi.ensureThread, "api.chat.ensureThread"), {
          actor: args.actor,
          ...(args.externalThreadId ? { externalThreadId: args.externalThreadId } : {}),
          ...(args.model ? { model: args.model } : {}),
          ...(args.cwd ? { cwd: args.cwd } : {}),
        });
      },
      ensureSession: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        return convex.mutation(requireDefined(chatApi.ensureSession, "api.chat.ensureSession"), {
          actor: args.actor,
          sessionId: args.sessionId,
          threadId: args.threadId,
        });
      },
      ingestSafe: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        const client = convex;

        const toIngestPayload = (sessionIdOverride: string) => ({
          actor: args.actor,
          sessionId: sessionIdOverride,
          threadId: args.threadId,
          deltas: args.deltas.map((delta) =>
            delta.type === "stream_delta"
              ? {
                  type: "stream_delta" as const,
                  eventId: delta.eventId,
                  turnId: delta.turnId,
                  streamId: delta.streamId,
                  kind: delta.kind,
                  payloadJson: delta.payloadJson,
                  cursorStart: delta.cursorStart,
                  cursorEnd: delta.cursorEnd,
                  createdAt: delta.createdAt,
                }
              : {
                  type: "lifecycle_event" as const,
                  eventId: delta.eventId,
                  ...(delta.turnId ? { turnId: delta.turnId } : {}),
                  kind: delta.kind,
                  payloadJson: delta.payloadJson,
                  createdAt: delta.createdAt,
                },
          ),
          runtime: startRuntimeOptions,
        });

        const runIngest = async (sessionIdOverride: string) =>
          client.mutation(requireDefined(chatApi.ingestBatch, "api.chat.ingestBatch"), toIngestPayload(sessionIdOverride));

        try {
          const initialResult = await runIngest(args.sessionId);
          if (initialResult.status !== "rejected") {
            return {
              status: initialResult.status,
              errors: mapIngestErrors(initialResult.errors as IngestBatchError[]),
            };
          }

          const initialErrors = initialResult.errors as IngestBatchError[];
          // Recoverability is contract-owned by ingestSafe errors[].recoverable.
          const hasRecoverableRejection = hasRecoverableIngestErrors(initialErrors);
          if (hasRecoverableRejection && activeSessionId && actor) {
            const nextSessionId = randomSessionId();
            activeSessionId = nextSessionId;
            await client.mutation(requireDefined(chatApi.ensureSession, "api.chat.ensureSession"), {
              actor,
              sessionId: nextSessionId,
              threadId: args.threadId,
            });

            emit({
              type: "global",
              payload: {
                kind: "sync/session_rolled_over",
                reason: "recoverable_rejected_status",
                threadId: args.threadId,
                errors: mapIngestErrorCodes(initialErrors),
              },
            });

            const retriedResult = await runIngest(nextSessionId);
            if (retriedResult.status === "rejected") {
              return {
                status: "partial",
                errors: mapIngestErrors(retriedResult.errors as IngestBatchError[]).map((error) => ({
                  ...error,
                  recoverable: true,
                })),
              };
            }
            return {
              status: retriedResult.status,
              errors: mapIngestErrors(retriedResult.errors as IngestBatchError[]),
            };
          }

          return {
            status: initialResult.status,
            errors: mapIngestErrors(initialErrors),
          };
        } catch (error) {
          throw error;
        }
      },
      upsertPendingServerRequest: async ({ actor: requestActor, request }) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        await convex.mutation(
          requireDefined(
            chatApi.upsertPendingServerRequestForHooks,
            "api.chat.upsertPendingServerRequestForHooks",
          ),
          {
            actor: requestActor,
            requestId: request.requestId,
            threadId: request.threadId,
            turnId: request.turnId,
            itemId: request.itemId,
            method: request.method,
            payloadJson: request.payloadJson,
            ...(request.reason ? { reason: request.reason } : {}),
            ...(request.questions ? { questionsJson: JSON.stringify(request.questions) } : {}),
            requestedAt: request.createdAt,
          },
        );
      },
      resolvePendingServerRequest: async ({ threadId, requestId, status, resolvedAt, responseJson }) => {
        if (!convex || !actor) {
          throw new Error("Convex client not initialized.");
        }
        await convex.mutation(
          requireDefined(
            chatApi.resolvePendingServerRequestForHooks,
            "api.chat.resolvePendingServerRequestForHooks",
          ),
          {
            actor,
            threadId,
            requestId,
            status,
            resolvedAt,
            ...(responseJson ? { responseJson } : {}),
          },
        );
      },
      listPendingServerRequests: async ({ threadId }) => {
        if (!convex || !actor) {
          return [];
        }
        return convex.query(
          requireDefined(
            chatApi.listPendingServerRequestsForHooks,
            "api.chat.listPendingServerRequestsForHooks",
          ),
          {
            actor,
            ...(threadId ? { threadId } : {}),
            limit: 100,
          },
        );
      },
      enqueueTurnDispatch: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        return convex.mutation(
          requireDefined(chatApi.enqueueTurnDispatch, "api.chat.enqueueTurnDispatch"),
          {
            actor: args.actor,
            threadId: args.threadId,
            ...(args.dispatchId ? { dispatchId: args.dispatchId } : {}),
            turnId: args.turnId,
            idempotencyKey: args.idempotencyKey,
            input: args.input,
          },
        );
      },
      claimNextTurnDispatch: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        return convex.mutation(
          requireDefined(chatApi.claimNextTurnDispatch, "api.chat.claimNextTurnDispatch"),
          {
            actor: args.actor,
            threadId: args.threadId,
            claimOwner: args.claimOwner,
            ...(args.leaseMs ? { leaseMs: args.leaseMs } : {}),
          },
        );
      },
      markTurnDispatchStarted: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        await convex.mutation(
          requireDefined(chatApi.markTurnDispatchStarted, "api.chat.markTurnDispatchStarted"),
          {
            actor: args.actor,
            threadId: args.threadId,
            dispatchId: args.dispatchId,
            claimToken: args.claimToken,
            ...(args.runtimeThreadId ? { runtimeThreadId: args.runtimeThreadId } : {}),
            ...(args.runtimeTurnId ? { runtimeTurnId: args.runtimeTurnId } : {}),
          },
        );
      },
      markTurnDispatchCompleted: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        await convex.mutation(
          requireDefined(chatApi.markTurnDispatchCompleted, "api.chat.markTurnDispatchCompleted"),
          {
            actor: args.actor,
            threadId: args.threadId,
            dispatchId: args.dispatchId,
            claimToken: args.claimToken,
          },
        );
      },
      markTurnDispatchFailed: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        await convex.mutation(
          requireDefined(chatApi.markTurnDispatchFailed, "api.chat.markTurnDispatchFailed"),
          {
            actor: args.actor,
            threadId: args.threadId,
            dispatchId: args.dispatchId,
            claimToken: args.claimToken,
            ...(args.code ? { code: args.code } : {}),
            reason: args.reason,
          },
        );
      },
      cancelTurnDispatch: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        await convex.mutation(
          requireDefined(chatApi.cancelTurnDispatch, "api.chat.cancelTurnDispatch"),
          {
            actor: args.actor,
            threadId: args.threadId,
            dispatchId: args.dispatchId,
            ...(args.claimToken ? { claimToken: args.claimToken } : {}),
            reason: args.reason,
          },
        );
      },
      upsertTokenUsage: async (args) => {
        if (!convex) {
          throw new Error("Convex client not initialized.");
        }
        await convex.mutation(
          requireDefined(chatApi.upsertTokenUsageForHooks, "api.chat.upsertTokenUsageForHooks"),
          {
            actor: args.actor,
            threadId: args.threadId,
            turnId: args.turnId,
            totalTokens: args.totalTokens,
            inputTokens: args.inputTokens,
            cachedInputTokens: args.cachedInputTokens,
            outputTokens: args.outputTokens,
            reasoningOutputTokens: args.reasoningOutputTokens,
            lastTotalTokens: args.lastTotalTokens,
            lastInputTokens: args.lastInputTokens,
            lastCachedInputTokens: args.lastCachedInputTokens,
            lastOutputTokens: args.lastOutputTokens,
            lastReasoningOutputTokens: args.lastReasoningOutputTokens,
            ...(args.modelContextWindow != null ? { modelContextWindow: args.modelContextWindow } : {}),
          },
        );
      },
    },
    handlers: {
      onState: (state) => {
        emitState({
          running: state.running,
          localThreadId: state.threadId,
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
        runtimeThreadId = event.threadId;
        emitState();
        if (event.kind === "turn/completed" || event.kind === "error") {
          void drainClaimedDispatches();
        }
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
    await runtime.start({
      actor: payload.actor,
      sessionId: activeSessionId,
      dispatchManaged: true,
      ...(payload.externalThreadId ? { externalThreadId: payload.externalThreadId } : {}),
      ...(payload.runtimeThreadId ? { runtimeThreadId: payload.runtimeThreadId } : {}),
      ...(payload.threadStrategy ? { threadStrategy: payload.threadStrategy } : {}),
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      ...(payload.deltaThrottleMs ? { ingestFlushMs: payload.deltaThrottleMs } : {}),
      dynamicTools: DYNAMIC_TOOLS,
      runtime: startRuntimeOptions,
    });

    emitState({ running: true, lastErrorCode: null, lastError: null });
    void drainClaimedDispatches();
    emit({ type: "ack", payload: { command: "start" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitState({ running: false, lastErrorCode: null, lastError: message });
    runtime = null;
    throw error;
  }
}

async function sendTurn(text: string): Promise<void> {
  if (!runtime || !convex || !actor) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  const localThreadId = bridgeState.localThreadId;
  if (!localThreadId) {
    throw new Error("Local thread binding not ready yet.");
  }
  await convex.mutation(
    requireDefined(chatApi.enqueueTurnDispatch, "api.chat.enqueueTurnDispatch"),
    {
      actor,
      threadId: localThreadId,
      dispatchId: randomUUID(),
      turnId: randomUUID(),
      idempotencyKey: randomUUID(),
      input: [{ type: "text", text }],
    },
  );
  await drainClaimedDispatches();
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
  idToken: string;
  accessToken: string;
}): Promise<void> {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  await runtime.respondChatgptAuthTokensRefresh({
    requestId: args.requestId,
    idToken: args.idToken,
    accessToken: args.accessToken,
  });
}

async function stopCurrentBridge(): Promise<void> {
  try {
    if (runtime) {
      await runtime.stop();
    }
  } finally {
    claimLoopRunning = false;
    runtime = null;
    convex = null;
    actor = null;
    activeSessionId = null;
    runtimeThreadId = null;
    emitState({
      running: false,
      localThreadId: null,
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
  switch (command.type) {
    case "start":
      await startBridge(command.payload);
      return;
    case "send_turn":
      await sendTurn(command.payload.text);
      emit({ type: "ack", payload: { command: "send_turn" } });
      return;
    case "respond_command_approval":
      await respondCommandApproval(command.payload.requestId, command.payload.decision);
      emit({ type: "ack", payload: { command: "respond_command_approval" } });
      return;
    case "respond_file_change_approval":
      await respondFileChangeApproval(command.payload.requestId, command.payload.decision);
      emit({ type: "ack", payload: { command: "respond_file_change_approval" } });
      return;
    case "respond_tool_user_input":
      await respondToolUserInput(command.payload.requestId, command.payload.answers);
      emit({ type: "ack", payload: { command: "respond_tool_user_input" } });
      return;
    case "account_read":
      await readAccount(command.payload.refreshToken);
      emit({ type: "ack", payload: { command: "account_read" } });
      return;
    case "account_login_start":
      await loginAccount(command.payload.params);
      emit({ type: "ack", payload: { command: "account_login_start" } });
      return;
    case "account_login_cancel":
      await cancelAccountLogin(command.payload.loginId);
      emit({ type: "ack", payload: { command: "account_login_cancel" } });
      return;
    case "account_logout":
      await logoutAccount();
      emit({ type: "ack", payload: { command: "account_logout" } });
      return;
    case "account_rate_limits_read":
      await readAccountRateLimits();
      emit({ type: "ack", payload: { command: "account_rate_limits_read" } });
      return;
    case "respond_chatgpt_auth_tokens_refresh":
      await respondChatgptAuthTokensRefresh(command.payload);
      emit({ type: "ack", payload: { command: "respond_chatgpt_auth_tokens_refresh" } });
      return;
    case "interrupt":
      interruptCurrentTurn();
      emit({ type: "ack", payload: { command: "interrupt" } });
      return;
    case "stop":
      await gracefulShutdown("stop", { emitAckCommand: "stop" });
      return;
    case "status":
      emitState();
      emit({ type: "ack", payload: { command: "status" } });
      return;
    default:
      break;
  }
}

let buffered = "";
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
      const command = JSON.parse(line) as HelperCommand;
      void handle(command).catch((error) => {
        emit({ type: "error", payload: { message: error instanceof Error ? error.message : String(error) } });
      });
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
