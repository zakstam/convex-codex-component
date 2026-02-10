import { ConvexHttpClient } from "convex/browser";
import {
  buildInitializeRequest,
  buildInitializedNotification,
  buildThreadStartRequest,
  buildTurnInterruptRequest,
  buildTurnStartTextRequest,
} from "@zakstam/codex-local-component/app-server";
import { CodexLocalBridge } from "@zakstam/codex-local-component/bridge";
import type {
  ClientNotification,
  ClientRequest,
  CodexResponse,
  ServerInboundMessage,
  ServerNotification,
} from "@zakstam/codex-local-component/protocol";
import { api } from "../convex/_generated/api.js";

type ActorContext = { tenantId: string; userId: string; deviceId: string };
type StartPayload = {
  convexUrl: string;
  actor: ActorContext;
  sessionId: string;
  codexBin?: string;
  model?: string;
  cwd?: string;
  deltaThrottleMs?: number;
  saveStreamDeltas?: boolean;
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
      };
    }
  | { type: "event"; payload: { kind: string; threadId: string; turnId?: string; streamId?: string } }
  | { type: "global"; payload: Record<string, unknown> }
  | { type: "protocol_error"; payload: { message: string; line: string } }
  | { type: "ack"; payload: { command: string } }
  | { type: "error"; payload: { message: string } };

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

const MAX_BATCH_SIZE = 32;
const IDLE_FLUSH_INTERVAL_MS = 5000;
let ACTIVE_FLUSH_INTERVAL_MS = 250;

let bridge: CodexLocalBridge | null = null;
let convex: ConvexHttpClient | null = null;
let actor: ActorContext | null = null;
let sessionId: string | null = null;
let threadId: string | null = null;
let turnId: string | null = null;
let turnInFlight = false;
let turnSettled = false;
let interruptRequested = false;
let nextRequestId = 1;

const pendingRequests = new Map<number, { method: string }>();
let ingestQueue: IngestDelta[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushTail: Promise<void> = Promise.resolve();

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

function updateState(next?: Partial<{ running: boolean; threadId: string | null; turnId: string | null; lastError: string | null }>) {
  emit({
    type: "state",
    payload: {
      running: !!bridge,
      threadId,
      turnId,
      lastError: null,
      ...next,
    },
  });
}

function isServerNotification(message: ServerInboundMessage): message is ServerNotification {
  return "method" in message;
}

function isResponse(message: ServerInboundMessage): message is CodexResponse {
  return "id" in message && !isServerNotification(message);
}

function normalizeIngestKind(kind: string): string {
  if (kind === "codex/event/task_started") {
    return "turn/started";
  }
  if (kind === "codex/event/task_complete") {
    return "turn/completed";
  }
  return kind;
}

function clearFlushTimer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

async function flushQueue(): Promise<void> {
  if (!convex || !actor || !sessionId) {
    return;
  }
  const client = convex;
  const activeActor = actor;
  const activeSessionId = sessionId;
  const next = flushTail.then(async () => {
    clearFlushTimer();
    while (ingestQueue.length > 0) {
      const batch = ingestQueue.splice(0, MAX_BATCH_SIZE);
      const first = batch[0];
      if (!first) {
        return;
      }
      const ingestPayload = {
        actor: activeActor,
        sessionId: activeSessionId,
        threadId: first.threadId,
        deltas: batch.map((delta) =>
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
        runtime: {
          saveStreamDeltas: true,
        },
      };

      try {
        await client.mutation(requireDefined(chatApi.ingestBatch, "api.chat.ingestBatch"), ingestPayload);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const needsSessionRollover =
          message.includes("E_SYNC_OUT_OF_ORDER") || message.includes("E_SYNC_REPLAY_GAP");
        if (!needsSessionRollover || !convex || !actor) {
          throw error;
        }

        const nextSessionId = randomSessionId();
        sessionId = nextSessionId;
        await convex.mutation(requireDefined(chatApi.ensureSession, "api.chat.ensureSession"), {
          actor,
          sessionId: nextSessionId,
          threadId: first.threadId,
        });

        emit({
          type: "global",
          payload: {
            kind: "sync/session_rolled_over",
            reason: message,
            threadId: first.threadId,
          },
        });

        await convex.mutation(requireDefined(chatApi.ingestBatch, "api.chat.ingestBatch"), {
          ...ingestPayload,
          sessionId: nextSessionId,
        });
      }
    }
  });

  flushTail = next.catch(() => undefined);
  await next;
}

function enqueueIngestDelta(delta: IngestDelta, forceFlush: boolean): Promise<void> {
  ingestQueue.push(delta);

  if (forceFlush || ingestQueue.length >= MAX_BATCH_SIZE) {
    return flushQueue();
  }

  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushQueue();
    }, turnInFlight ? ACTIVE_FLUSH_INTERVAL_MS : IDLE_FLUSH_INTERVAL_MS);
  }

  return Promise.resolve();
}

function requestId(): number {
  const id = nextRequestId;
  nextRequestId += 1;
  return id;
}

function sendMessage(message: ClientRequest | ClientNotification, trackedMethod?: string) {
  if (!bridge) {
    throw new Error("Bridge is not running");
  }
  bridge.send(message);
  if ("id" in message && typeof message.id === "number" && trackedMethod) {
    pendingRequests.set(message.id, { method: trackedMethod });
  }
}

async function startBridge(payload: StartPayload) {
  if (bridge) {
    emit({ type: "ack", payload: { command: "start" } });
    return;
  }

  convex = new ConvexHttpClient(payload.convexUrl);
  actor = payload.actor;
  sessionId = payload.sessionId ? `${payload.sessionId}-${randomSessionId()}` : randomSessionId();
  ACTIVE_FLUSH_INTERVAL_MS = payload.deltaThrottleMs ?? 250;

  bridge = new CodexLocalBridge(
    {
      ...(payload.codexBin ? { codexBin: payload.codexBin } : {}),
      cwd: payload.cwd ?? process.cwd(),
    },
    {
      onEvent: async (event) => {
        if (!convex || !actor || !sessionId) {
          return;
        }

        if (!threadId) {
          threadId = event.threadId;
          await convex.mutation(requireDefined(chatApi.ensureThread, "api.chat.ensureThread"), {
            actor,
            threadId,
            ...(payload.model ? { model: payload.model } : {}),
            ...(payload.cwd ? { cwd: payload.cwd } : {}),
          });
          await convex.mutation(requireDefined(chatApi.ensureSession, "api.chat.ensureSession"), {
            actor,
            sessionId,
            threadId,
          });
          updateState({ threadId });
        }

        if (event.kind === "turn/started" && event.turnId) {
          turnId = event.turnId;
          turnInFlight = true;
          turnSettled = false;
          updateState({ turnId });
          if (interruptRequested) {
            const interruptReq = buildTurnInterruptRequest(requestId(), {
              threadId: event.threadId,
              turnId: event.turnId,
            });
            sendMessage(interruptReq, "turn/interrupt");
            interruptRequested = false;
          }
        }

        if (event.kind === "turn/completed" || event.kind === "codex/event/turn_aborted") {
          turnId = null;
          turnInFlight = false;
          turnSettled = true;
          updateState({ turnId: null });
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

        const delta: IngestDelta =
          event.streamId && event.turnId
            ? {
                type: "stream_delta",
                eventId: event.eventId,
                kind: normalizeIngestKind(event.kind),
                payloadJson: event.payloadJson,
                cursorStart: event.cursorStart,
                cursorEnd: event.cursorEnd,
                createdAt: event.createdAt,
                threadId: event.threadId,
                turnId: event.turnId,
                streamId: event.streamId,
              }
            : {
                type: "lifecycle_event",
                eventId: event.eventId,
                kind: normalizeIngestKind(event.kind),
                payloadJson: event.payloadJson,
                createdAt: event.createdAt,
                threadId: event.threadId,
                ...(event.turnId ? { turnId: event.turnId } : {}),
              };

        const forceFlush =
          event.kind === "turn/completed" ||
          event.kind === "codex/event/turn_aborted" ||
          event.kind === "error";

        await enqueueIngestDelta(delta, forceFlush);
      },
      onGlobalMessage: async (message) => {
        if (isResponse(message) && typeof message.id === "number") {
          const pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);
          if (message.error) {
            emit({
              type: "error",
              payload: {
                message: `Request failed (${pending?.method ?? "unknown"}): ${message.error.message}`,
              },
            });
          }
          return;
        }

        emit({ type: "global", payload: message as Record<string, unknown> });
      },
      onProtocolError: async ({ line, error }) => {
        updateState({ lastError: error.message });
        emit({ type: "protocol_error", payload: { message: error.message, line } });
      },
      onProcessExit: (code) => {
        updateState({ running: false, turnId: null, lastError: `codex exited with code ${String(code)}` });
      },
    },
  );

  bridge.start();

  const initializeReq = buildInitializeRequest(requestId(), {
    name: "codex_local_tauri_example",
    title: "Codex Local Tauri Example",
    version: "0.1.0",
  });
  sendMessage(initializeReq, "initialize");
  sendMessage(buildInitializedNotification());
  const threadStartReq = buildThreadStartRequest(requestId(), {
    ...(payload.model ? { model: payload.model } : {}),
    ...(payload.cwd ? { cwd: payload.cwd } : {}),
  });
  sendMessage(threadStartReq, "thread/start");

  updateState({ running: true });
  emit({ type: "ack", payload: { command: "start" } });
}

function sendTurn(text: string) {
  if (!bridge || !threadId) {
    throw new Error("Bridge/thread not ready. Start runtime first.");
  }
  if (turnInFlight && !turnSettled) {
    throw new Error("A turn is already in flight.");
  }

  const req = buildTurnStartTextRequest(requestId(), {
    threadId,
    text,
  });
  turnInFlight = true;
  turnSettled = false;
  sendMessage(req, "turn/start");
}

function interruptCurrentTurn() {
  if (!bridge || !threadId) {
    return;
  }
  if (!turnId) {
    interruptRequested = true;
    return;
  }
  const interruptReq = buildTurnInterruptRequest(requestId(), { threadId, turnId });
  sendMessage(interruptReq, "turn/interrupt");
}

async function stopCurrentBridge() {
  clearFlushTimer();
  await flushQueue();
  bridge?.stop();
  bridge = null;
  threadId = null;
  turnId = null;
  turnInFlight = false;
  turnSettled = false;
  interruptRequested = false;
  pendingRequests.clear();
  updateState({ running: false, threadId: null, turnId: null });
}

async function handle(command: HelperCommand) {
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
      updateState();
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
