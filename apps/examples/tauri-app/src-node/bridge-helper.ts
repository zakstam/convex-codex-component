import { ConvexHttpClient } from "convex/browser";
import {
  createCodexHostRuntime,
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

type ActorContext = { tenantId: string; userId: string; deviceId: string };
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
        lastError: string | null;
        runtimeThreadId: string | null;
        pendingServerRequestCount: number;
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

function isRecoverableSyncCode(code: unknown): boolean {
  return code === "OUT_OF_ORDER" || code === "REPLAY_GAP";
}

function toErrorCode(value: unknown): string {
  if (typeof value !== "string") {
    return "UNKNOWN";
  }
  return value;
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
  lastError: string | null;
  pendingServerRequestCount: number;
} = {
  running: false,
  localThreadId: null,
  turnId: null,
  lastError: null,
  pendingServerRequestCount: 0,
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
      lastError: bridgeState.lastError,
      runtimeThreadId,
      pendingServerRequestCount: bridgeState.pendingServerRequestCount,
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
              errors: initialResult.errors.map((error) => ({
                code: toErrorCode(error.code),
                message: error.message,
                recoverable: error.recoverable,
              })),
            };
          }

          const hasRecoverableRejection = initialResult.errors.some((error) =>
            isRecoverableSyncCode(error.code),
          );
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
                errors: initialResult.errors.map((error) => ({
                  code: toErrorCode(error.code),
                  message: error.message,
                })),
              },
            });

            const retriedResult = await runIngest(nextSessionId);
            if (retriedResult.status === "rejected") {
              return {
                status: "partial",
                errors: retriedResult.errors.map((error) => ({
                  code: toErrorCode(error.code),
                  message: error.message,
                  recoverable: true,
                })),
              };
            }
            return {
              status: retriedResult.status,
              errors: retriedResult.errors.map((error) => ({
                code: toErrorCode(error.code),
                message: error.message,
                recoverable: error.recoverable,
              })),
            };
          }

          return {
            status: initialResult.status,
            errors: initialResult.errors.map((error) => ({
              code: toErrorCode(error.code),
              message: error.message,
              recoverable: error.recoverable,
            })),
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const needsSessionRollover =
            message.includes("E_SYNC_OUT_OF_ORDER") || message.includes("E_SYNC_REPLAY_GAP");

          if (!needsSessionRollover || !activeSessionId || !actor) {
            throw error;
          }

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
              reason: message,
              threadId: args.threadId,
            },
          });

          const result = await runIngest(nextSessionId);
          return {
            status: result.status,
            errors: result.errors.map((ingestError) => ({
              code: toErrorCode(ingestError.code),
              message: ingestError.message,
              recoverable: ingestError.recoverable,
            })),
          };
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
    },
    handlers: {
      onState: (state) => {
        emitState({
          running: state.running,
          localThreadId: state.threadId,
          turnId: state.turnId,
          lastError: state.lastError,
          pendingServerRequestCount: state.pendingServerRequestCount,
        });
      },
      onEvent: (event) => {
        runtimeThreadId = event.threadId;
        emitState();
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
            emitState({ lastError: possibleError.message });
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
        emitState({ lastError: message });
        emit({ type: "protocol_error", payload: { message, line } });
      },
    },
  });

  try {
    await runtime.start({
      actor: payload.actor,
      sessionId: activeSessionId,
      ...(payload.externalThreadId ? { externalThreadId: payload.externalThreadId } : {}),
      ...(payload.runtimeThreadId ? { runtimeThreadId: payload.runtimeThreadId } : {}),
      ...(payload.threadStrategy ? { threadStrategy: payload.threadStrategy } : {}),
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.cwd ? { cwd: payload.cwd } : {}),
      ...(payload.deltaThrottleMs ? { ingestFlushMs: payload.deltaThrottleMs } : {}),
      dynamicTools: DYNAMIC_TOOLS,
      runtime: startRuntimeOptions,
    });

    emitState({ running: true, lastError: null });
    emit({ type: "ack", payload: { command: "start" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emitState({ running: false, lastError: message });
    runtime = null;
    throw error;
  }
}

function sendTurn(text: string): void {
  if (!runtime) {
    throw new Error("Bridge/runtime not ready. Start runtime first.");
  }
  runtime.sendTurn(text);
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
    runtimeThreadId = null;
    emitState({
      running: false,
      localThreadId: null,
      turnId: null,
      lastError: null,
      pendingServerRequestCount: 0,
    });
  }
}

async function handle(command: HelperCommand): Promise<void> {
  switch (command.type) {
    case "start":
      await startBridge(command.payload);
      return;
    case "send_turn":
      sendTurn(command.payload.text);
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
    case "interrupt":
      interruptCurrentTurn();
      emit({ type: "ack", payload: { command: "interrupt" } });
      return;
    case "stop":
      await stopCurrentBridge();
      emit({ type: "ack", payload: { command: "stop" } });
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
