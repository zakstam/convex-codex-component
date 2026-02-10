import { ConvexHttpClient } from "convex/browser";
import { createCodexHostRuntime, type CodexHostRuntime } from "@zakstam/codex-local-component/host";
import type { ServerInboundMessage } from "@zakstam/codex-local-component/protocol";
import { api } from "../convex/_generated/api.js";

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
  | { type: "interrupt" }
  | { type: "stop" }
  | { type: "status" };

type HelperEvent =
  | {
      type: "state";
      payload: {
        running: boolean;
        threadId: string | null;
        turnId: string | null;
        lastError: string | null;
        runtimeThreadId: string | null;
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
  threadId: string | null;
  turnId: string | null;
  lastError: string | null;
} = {
  running: false,
  threadId: null,
  turnId: null,
  lastError: null,
};

function emitState(next?: Partial<typeof bridgeState>): void {
  bridgeState = {
    ...bridgeState,
    ...(next ?? {}),
  };

  emit({
    type: "state",
    payload: {
      running: bridgeState.running,
      threadId: bridgeState.threadId,
      turnId: bridgeState.turnId,
      lastError: bridgeState.lastError,
      runtimeThreadId,
    },
  });
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
          const result = await runIngest(args.sessionId);
          return {
            status: result.status,
            errors: result.errors.map((error) => ({
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
    },
    handlers: {
      onState: (state) => {
        emitState({
          running: state.running,
          threadId: state.threadId,
          turnId: state.turnId,
          lastError: state.lastError,
        });
      },
      onEvent: (event) => {
        runtimeThreadId = event.threadId;
        emitState();
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
    emitState({ running: false, threadId: null, turnId: null, lastError: null });
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
