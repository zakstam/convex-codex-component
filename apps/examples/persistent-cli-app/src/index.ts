import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { stdin, stdout } from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { CodexLocalBridge } from "@zakstam/codex-local-component/bridge";
import { turnIdForPayload } from "@zakstam/codex-local-component/protocol";
import type {
  ClientNotification,
  ClientRequest,
  CodexResponse,
  NormalizedEvent,
  ServerInboundMessage,
  ServerNotification,
} from "@zakstam/codex-local-component/protocol";
import { api } from "../convex/_generated/api.js";

type EnvMap = Record<string, string>;

type IngestDelta = {
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

const MAX_BATCH_SIZE = 32;
const IDLE_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_ACTIVE_FLUSH_INTERVAL_MS = 250;
const TURN_LIFECYCLE_KINDS = new Set<string>(["turn/started", "turn/completed"]);

function parseEnvBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
}

function parseEnvNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function readEnvFile(path: string): EnvMap {
  if (!existsSync(path)) {
    return {};
  }
  const out: EnvMap = {};
  const content = readFileSync(path, "utf8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

function deploymentToUrl(deploymentRaw: string | undefined): string | null {
  if (!deploymentRaw) {
    return null;
  }
  const deployment = deploymentRaw.includes(":")
    ? deploymentRaw.slice(deploymentRaw.lastIndexOf(":") + 1)
    : deploymentRaw;
  if (!deployment) {
    return null;
  }
  return `https://${deployment}.convex.cloud`;
}

function resolveConvexUrl(): string | null {
  if (process.env.CONVEX_URL) {
    return process.env.CONVEX_URL;
  }
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    return process.env.NEXT_PUBLIC_CONVEX_URL;
  }

  const envLocal = readEnvFile(join(process.cwd(), ".env.local"));
  const convexEnvLocal = readEnvFile(join(process.cwd(), "convex", ".env.local"));
  const merged: EnvMap = { ...envLocal, ...convexEnvLocal };

  if (merged.CONVEX_URL) {
    return merged.CONVEX_URL;
  }
  if (merged.NEXT_PUBLIC_CONVEX_URL) {
    return merged.NEXT_PUBLIC_CONVEX_URL;
  }
  return deploymentToUrl(merged.CONVEX_DEPLOYMENT);
}

function isServerNotification(message: ServerInboundMessage): message is ServerNotification {
  return "method" in message;
}

function isResponse(message: ServerInboundMessage): message is CodexResponse {
  return "id" in message && !isServerNotification(message);
}

function extractAssistantDelta(message: ServerInboundMessage): string | null {
  if (!("method" in message)) {
    return null;
  }

  if (message.method === "item/agentMessage/delta") {
    const params =
      typeof message.params === "object" && message.params !== null
        ? (message.params as Record<string, unknown>)
        : null;
    return typeof params?.delta === "string" ? params.delta : null;
  }
  return null;
}

function stripControlChars(text: string): string {
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function wrapLine(line: string, width: number): string[] {
  if (width <= 1) {
    return [line];
  }
  if (line.length <= width) {
    return [line];
  }

  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    out.push(line.slice(i, i + width));
    i += width;
  }
  return out;
}

class Tui {
  private lines: string[] = [];
  private input = "";
  private assistantLineIndex: number | null = null;
  private status = "";
  private readingEscapeSequence = false;
  private onSubmit: ((line: string) => void) | null = null;
  private disposed = false;

  setStatus(status: string): void {
    this.status = status;
    this.render();
  }

  appendLine(line: string): void {
    this.assistantLineIndex = null;
    this.lines.push(line);
    this.render();
  }

  appendAssistantDelta(delta: string): void {
    if (this.assistantLineIndex === null) {
      this.lines.push("assistant> ");
      this.assistantLineIndex = this.lines.length - 1;
    }
    this.lines[this.assistantLineIndex] = `${this.lines[this.assistantLineIndex]}${delta}`;
    this.render();
  }

  closeAssistantLine(): void {
    this.assistantLineIndex = null;
    this.render();
  }

  start(onSubmit: (line: string) => void): void {
    this.onSubmit = onSubmit;

    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(true);
    }
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", this.handleInput);

    process.stdout.on("resize", this.renderBound);
    this.render();
  }

  stop(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    stdin.off("data", this.handleInput);
    if (stdin.isTTY && typeof stdin.setRawMode === "function") {
      stdin.setRawMode(false);
    }
    process.stdout.off("resize", this.renderBound);
    stdout.write("\n");
  }

  private readonly renderBound = () => this.render();

  private readonly handleInput = (chunk: string): void => {
    const text = String(chunk);
    let changed = false;

    for (const ch of text) {
      if (this.readingEscapeSequence) {
        // Ignore terminal escape sequence bytes (e.g. arrow keys: ESC [ A).
        if (ch >= "@" && ch <= "~") {
          this.readingEscapeSequence = false;
        }
        continue;
      }

      if (ch === "\u001b") {
        this.readingEscapeSequence = true;
        continue;
      }

      if (ch === "\u0003") {
        this.onSubmit?.("/exit");
        return;
      }

      if (ch === "\r" || ch === "\n") {
        const line = this.input.trim();
        this.input = "";
        changed = true;
        if (line.length > 0) {
          this.onSubmit?.(line);
        }
        continue;
      }

      if (ch === "\u007f" || ch === "\b") {
        if (this.input.length > 0) {
          this.input = this.input.slice(0, -1);
          changed = true;
        }
        continue;
      }

      const printable = stripControlChars(ch);
      if (!printable) {
        continue;
      }
      this.input += printable;
      changed = true;
    }

    if (changed) {
      this.render();
    }
  };

  private render(): void {
    if (this.disposed) {
      return;
    }

    const cols = Math.max(40, stdout.columns ?? 80);
    const rows = Math.max(12, stdout.rows ?? 24);
    const contentHeight = Math.max(3, rows - 6);

    const wrapped: string[] = [];
    for (const raw of this.lines) {
      const parts = raw.split("\n");
      for (const part of parts) {
        wrapped.push(...wrapLine(part, cols));
      }
    }

    const visible = wrapped.slice(Math.max(0, wrapped.length - contentHeight));
    while (visible.length < contentHeight) {
      visible.unshift("");
    }

    const header = this.status.length > 0 ? this.status : "codex-local persistent tui";
    const sep = "-".repeat(cols);

    let out = "\x1b[2J\x1b[H";
    out += `${header.slice(0, cols)}\n`;
    out += `${sep}\n`;
    out += `${visible.join("\n")}\n`;
    out += `${sep}\n`;
    out += `you> ${this.input}`;

    stdout.write(out);
  }
}

const convexUrl = resolveConvexUrl();
if (!convexUrl) {
  console.error("Missing Convex URL. Run `pnpm run dev:convex` first, or set CONVEX_URL explicitly.");
  process.exit(1);
}

const model = process.env.CODEX_MODEL ?? null;
const cwd = process.env.CODEX_CWD ?? process.cwd();

const actor = {
  userId: process.env.ACTOR_USER_ID ?? "demo-user",
};

const saveStreamDeltas = parseEnvBoolean(process.env.SAVE_STREAM_DELTAS, false);
const activeFlushIntervalMs = parseEnvNumber(
  process.env.DELTA_THROTTLE_MS,
  DEFAULT_ACTIVE_FLUSH_INTERVAL_MS,
);
const syncRuntimeOptions = {
  saveStreamDeltas,
};

const convex = new ConvexHttpClient(convexUrl);
const chatApi = (() => {
  const moduleApi = api.chat;
  if (!moduleApi) {
    throw new Error("Generated chat API is unavailable");
  }
  return moduleApi;
})();

function requireDefined<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Required API ref missing: ${name}`);
  }
  return value;
}

const chatFns = {
  validateHostWiring: requireDefined(chatApi.validateHostWiring, "chat.validateHostWiring"),
  ensureThread: requireDefined(chatApi.ensureThread, "chat.ensureThread"),
  ensureSession: requireDefined(chatApi.ensureSession, "chat.ensureSession"),
  ingestBatch: requireDefined(chatApi.ingestBatch, "chat.ingestBatch"),
  persistenceStats: requireDefined(chatApi.persistenceStats, "chat.persistenceStats"),
  durableHistoryStats: requireDefined(chatApi.durableHistoryStats, "chat.durableHistoryStats"),
  threadSnapshot: requireDefined(chatApi.threadSnapshot, "chat.threadSnapshot"),
} as const;

async function assertHostWiring(): Promise<void> {
  const validation = await convex.query(chatFns.validateHostWiring, { actor });
  const checks = validation.checks as Array<{ name: string; ok: boolean; error?: string }>;
  if (validation.ok) {
    return;
  }
  const failed = checks.filter((check: { ok: boolean }) => !check.ok);
  const reason = failed.length
    ? failed.map((check: { name: string; error?: string }) => `${check.name}: ${check.error ?? "unknown error"}`).join("; ")
    : "unknown wiring failure";
  throw new Error(`Host wiring validation failed: ${reason}`);
}

const sessionId = randomUUID();
const runId = randomUUID();

const tui = new Tui();

let nextId = 1;
let threadId: string | null = null;
let turnId: string | null = null;
let turnInFlight = false;
let turnSettled = false;
let interruptRequested = false;
let queuedTurnSubmission = false;
let pendingTurn: { inputText: string; idempotencyKey: string } | null = null;
let exiting = false;

let resolveThreadReady: (() => void) | null = null;
let rejectThreadReady: ((error: Error) => void) | null = null;
let resolveTurnDone: (() => void) | null = null;
let rejectTurnDone: ((error: Error) => void) | null = null;

type PendingRequest = { method: string };
const pendingRequests = new Map<number, PendingRequest>();

let eventChain: Promise<void> = Promise.resolve();
let commandChain: Promise<void> = Promise.resolve();
let ingestQueue: IngestDelta[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushTail: Promise<void> = Promise.resolve();

function requestId(): number {
  const id = nextId;
  nextId += 1;
  return id;
}

function updateStatus(): void {
  const thread = threadId ?? "(starting)";
  const turn = turnInFlight ? `turn=${turnId ?? "pending"}` : "idle";
  tui.setStatus(`[run-id] ${runId} | thread=${thread} | ${turn}`);
}

function sendMessage(
  bridge: CodexLocalBridge,
  message: ClientRequest | ClientNotification,
  trackedMethod?: string,
): void {
  bridge.send(message);
  if ("id" in message && typeof message.id === "number" && trackedMethod) {
    pendingRequests.set(message.id, { method: trackedMethod });
  }
}

function clearFlushTimer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
}

function readAssistantDeltaPayload(payloadJson: string): {
  payload: ServerNotification;
  delta: string;
} | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("method" in parsed) ||
    (parsed as { method?: unknown }).method !== "item/agentMessage/delta"
  ) {
    return null;
  }

  const payload = parsed as ServerNotification;
  const methodPayload = payload as Extract<ServerNotification, { method: "item/agentMessage/delta" }>;
  if (typeof methodPayload.params.delta !== "string") {
    return null;
  }

  return { payload, delta: methodPayload.params.delta };
}

function mergeAssistantDeltaPair(first: IngestDelta, second: IngestDelta): IngestDelta | null {
  if (
    first.kind !== "item/agentMessage/delta" ||
    second.kind !== "item/agentMessage/delta" ||
    first.threadId !== second.threadId ||
    first.turnId !== second.turnId ||
    first.streamId !== second.streamId ||
    first.cursorEnd !== second.cursorStart
  ) {
    return null;
  }

  const firstPayload = readAssistantDeltaPayload(first.payloadJson);
  const secondPayload = readAssistantDeltaPayload(second.payloadJson);
  if (!firstPayload || !secondPayload) {
    return null;
  }

  const mergedPayload = {
    ...firstPayload.payload,
    params: {
      ...firstPayload.payload.params,
      delta: `${firstPayload.delta}${secondPayload.delta}`,
    },
  } as Extract<ServerNotification, { method: "item/agentMessage/delta" }>;

  return {
    ...first,
    eventId: second.eventId,
    payloadJson: JSON.stringify(mergedPayload),
    cursorEnd: second.cursorEnd,
    createdAt: second.createdAt,
  };
}

async function flushQueue(): Promise<void> {
  const next = flushTail.then(async () => {
    clearFlushTimer();
    while (ingestQueue.length > 0) {
      const batch = ingestQueue.splice(0, MAX_BATCH_SIZE);
      const first = batch[0];
      if (!first) {
        return;
      }
      await convex.mutation(chatFns.ingestBatch, {
        actor,
        sessionId,
        threadId: first.threadId,
        runtime: syncRuntimeOptions,
        deltas: batch.map((delta) => ({
          type: "stream_delta" as const,
          eventId: delta.eventId,
          turnId: delta.turnId,
          streamId: delta.streamId,
          kind: delta.kind,
          payloadJson: delta.payloadJson,
          cursorStart: delta.cursorStart,
          cursorEnd: delta.cursorEnd,
          createdAt: delta.createdAt,
        })),
      });
    }
  });

  flushTail = next.catch(() => undefined);
  await next;
}

function enqueueIngestDelta(delta: IngestDelta, forceFlush: boolean): Promise<void> {
  const tail = ingestQueue[ingestQueue.length - 1];
  if (tail) {
    const merged = mergeAssistantDeltaPair(tail, delta);
    if (merged) {
      ingestQueue[ingestQueue.length - 1] = merged;
    } else {
      ingestQueue.push(delta);
    }
  } else {
    ingestQueue.push(delta);
  }

  if (forceFlush || ingestQueue.length >= MAX_BATCH_SIZE) {
    return flushQueue();
  }

  if (!flushTimer) {
    const intervalMs = turnInFlight ? activeFlushIntervalMs : IDLE_FLUSH_INTERVAL_MS;
    flushTimer = setTimeout(() => {
      void flushQueue().catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        tui.appendLine(`[persist-flush-error] ${reason}`);
      });
    }, intervalMs);
  }

  return Promise.resolve();
}

async function waitForThreadStart(): Promise<void> {
  if (threadId) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    resolveThreadReady = resolve;
    rejectThreadReady = reject;
  });
}

async function runTurn(bridge: CodexLocalBridge, text: string): Promise<void> {
  if (!threadId) {
    throw new Error("Thread is not ready.");
  }
  queuedTurnSubmission = false;
  const activeThreadId = threadId;
  if (turnInFlight) {
    throw new Error("A turn is already in progress. Use /interrupt first.");
  }

  turnInFlight = true;
  turnSettled = false;
  turnId = null;
  updateStatus();

  pendingTurn = {
    inputText: text,
    idempotencyKey: randomUUID(),
  };

  tui.appendLine(`you> ${text}`);

  await new Promise<void>((resolve, reject) => {
    resolveTurnDone = resolve;
    rejectTurnDone = reject;

    const id = requestId();
    const turnStart: ClientRequest = {
      method: "turn/start",
      id,
      params: {
        threadId: activeThreadId,
        input: [
          {
            type: "text",
            text,
            text_elements: [],
          },
        ],
      },
    };
    sendMessage(bridge, turnStart, "turn/start");
  });
}

function interruptTurn(bridge: CodexLocalBridge): void {
  if (!threadId) {
    tui.appendLine("system> no active turn to interrupt");
    return;
  }

  if (!turnInFlight) {
    if (queuedTurnSubmission || pendingTurn) {
      interruptRequested = true;
      tui.appendLine("system> interrupt queued (turn is starting)");
      return;
    }
    tui.appendLine("system> no active turn to interrupt");
    return;
  }

  if (interruptRequested) {
    tui.appendLine("system> interrupt already requested");
    return;
  }
  interruptRequested = true;

  // Send modern turn-level interrupt when turn id is known.
  if (turnId) {
    const interruptReq: ClientRequest = {
      method: "turn/interrupt",
      id: requestId(),
      params: { threadId, turnId },
    };
    sendMessage(bridge, interruptReq, "turn/interrupt");
  }

  tui.appendLine("system> interrupt requested");
}

async function logPersistenceStats(): Promise<void> {
  if (!threadId) {
    return;
  }
  const stats = await convex.query(chatFns.persistenceStats, {
    actor,
    threadId,
  });
  const history = await convex.query(chatFns.durableHistoryStats, {
    actor,
    threadId,
  });
  tui.appendLine(
    `persisted> streams=${stats.streamCount} deltas=${stats.deltaCount} messages=${history.messageCountInPage}`,
  );
}

function requiresTurnContext(kind: string): boolean {
  return kind.startsWith("turn/") || kind.startsWith("item/");
}

function toIngestDelta(event: NormalizedEvent): IngestDelta | null {
  const canonicalLifecycleTurnId = TURN_LIFECYCLE_KINDS.has(event.kind)
    ? turnIdForPayload(event.kind, event.payloadJson)
    : null;
  const resolvedTurnId = canonicalLifecycleTurnId ?? event.turnId ?? turnId;
  if (TURN_LIFECYCLE_KINDS.has(event.kind) && !canonicalLifecycleTurnId) {
    throw new Error(`Protocol event missing canonical payload turn id for lifecycle kind: ${event.kind}`);
  }
  if (!resolvedTurnId) {
    if (requiresTurnContext(event.kind)) {
      throw new Error(`Protocol event missing turnId for turn-scoped kind: ${event.kind}`);
    }
    return null;
  }

  if (!event.streamId) {
    throw new Error(`Protocol event missing streamId for turn-scoped kind: ${event.kind}`);
  }

  return {
    eventId: event.eventId,
    kind: event.kind,
    payloadJson: event.payloadJson,
    cursorStart: event.cursorStart,
    cursorEnd: event.cursorEnd,
    createdAt: event.createdAt,
    threadId: event.threadId,
    turnId: resolvedTurnId,
    streamId: event.streamId,
  };
}

async function handleEvent(event: NormalizedEvent): Promise<void> {
  if (threadId === null) {
    threadId = event.threadId;
    updateStatus();
    await convex.mutation(chatFns.ensureThread, {
      actor,
      threadId,
      ...(model ? { model } : {}),
      cwd,
    });
    resolveThreadReady?.();
    resolveThreadReady = null;
    rejectThreadReady = null;
  }

  const payload = JSON.parse(event.payloadJson) as ServerInboundMessage;
  const delta = extractAssistantDelta(payload);
  if (delta) {
    tui.appendAssistantDelta(delta);
  }

  if (event.kind === "turn/started" && event.turnId) {
    turnId = event.turnId;
    updateStatus();
    if (interruptRequested) {
      const interruptReq: ClientRequest = {
        method: "turn/interrupt",
        id: requestId(),
        params: { threadId: event.threadId, turnId: event.turnId },
      };
      sendMessage(bridge, interruptReq, "turn/interrupt");
    }
    if (pendingTurn) {
      pendingTurn = null;
    }
  }

  const ingested = toIngestDelta(event);
  if (ingested) {
    const terminal = ingested.kind === "turn/completed";
    await enqueueIngestDelta(ingested, terminal);
  }

  if (event.kind === "turn/completed") {
    if (!turnInFlight || turnSettled) {
      return;
    }
    turnSettled = true;
    turnInFlight = false;
    turnId = null;
    interruptRequested = false;
    pendingTurn = null;
    queuedTurnSubmission = false;
    updateStatus();

    await flushQueue();
    tui.closeAssistantLine();
    await logPersistenceStats();

    resolveTurnDone?.();
    resolveTurnDone = null;
    rejectTurnDone = null;
    return;
  }

}

function enqueueEvent(event: NormalizedEvent): Promise<void> {
  const next = eventChain.then(() => handleEvent(event));
  eventChain = next.catch(() => undefined);
  return next;
}

const bridge = new CodexLocalBridge(
  {
    ...(process.env.CODEX_BIN ? { codexBin: process.env.CODEX_BIN } : {}),
    cwd,
  },
  {
    onEvent: async (event) => {
      await enqueueEvent(event);
    },

    onGlobalMessage: async (message) => {
      if (isResponse(message)) {
        if (typeof message.id === "number") {
          const pending = pendingRequests.get(message.id);
          pendingRequests.delete(message.id);

          if (message.error) {
            const error = new Error(
              `Request failed (${pending?.method ?? "unknown"}): ${message.error.message} (${message.error.code})`,
            );

            if (pending?.method === "thread/start") {
              rejectThreadReady?.(error);
              resolveThreadReady = null;
              rejectThreadReady = null;
              return;
            }

            if (pending?.method === "turn/start" && turnInFlight && !turnSettled) {
              turnSettled = true;
              turnInFlight = false;
              turnId = null;
              interruptRequested = false;
              pendingTurn = null;
              queuedTurnSubmission = false;
              updateStatus();
              rejectTurnDone?.(error);
              resolveTurnDone = null;
              rejectTurnDone = null;
              return;
            }

            tui.appendLine(`[response-error] ${error.message}`);
          }
        }
        return;
      }

      if (isServerNotification(message) && message.method === "error") {
        tui.appendLine(`[server-error] ${JSON.stringify(message.params)}`);
      }
    },

    onProtocolError: async ({ line, error }) => {
      tui.appendLine(`[protocol-error] ${error.message}`);
      tui.appendLine(`[protocol-error-line] ${line}`);
      rejectThreadReady?.(error);
      rejectTurnDone?.(error);
      await shutdown(1);
    },

    onProcessExit: (code) => {
      if (!exiting) {
        tui.appendLine(`[fatal] codex app-server exited unexpectedly (code=${String(code)})`);
        void shutdown(1);
      }
    },
  },
);

async function startFlow(): Promise<void> {
  bridge.start();

  const initializeRequest: ClientRequest = {
    method: "initialize",
    id: requestId(),
    params: {
      clientInfo: {
        name: "codex_local_persistent_cli_tui",
        title: "Codex Local Persistent CLI TUI",
        version: "0.2.0",
      },
      capabilities: null,
    },
  };

  const initialized: ClientNotification = { method: "initialized" };

  const threadStart: ClientRequest = {
    method: "thread/start",
    id: requestId(),
    params: {
      model,
      cwd,
      experimentalRawEvents: false,
    },
  };

  sendMessage(bridge, initializeRequest, "initialize");
  sendMessage(bridge, initialized);
  sendMessage(bridge, threadStart, "thread/start");

  await waitForThreadStart();
  if (threadId) {
    await convex.mutation(chatFns.ensureSession, {
      actor,
      sessionId,
      threadId,
    });
  }
  updateStatus();
  tui.appendLine(`thread> ready (${threadId}) session=${sessionId}`);
  await logPersistenceStats();
  tui.appendLine("commands> /interrupt /state /exit");
}

async function handleCommand(line: string): Promise<void> {
  if (line === "/exit") {
    await shutdown(0);
    return;
  }

  if (line === "/interrupt") {
    interruptTurn(bridge);
    return;
  }

  if (line === "/state") {
    if (!threadId) {
      tui.appendLine("state> no thread yet");
      return;
    }
    const state = await convex.query(chatFns.threadSnapshot, {
      actor,
      threadId,
    });
    const stats = await convex.query(chatFns.persistenceStats, {
      actor,
      threadId,
    });
    const history = await convex.query(chatFns.durableHistoryStats, {
      actor,
      threadId,
    });
    tui.appendLine(
      `state> thread=${state.threadId} turns=${state.turns.length} activeStreams=${state.activeStreams.length} pendingApprovals=${state.pendingApprovals.length} deltas=${stats.deltaCount} messages=${history.messageCountInPage}`,
    );
    return;
  }

  try {
    await runTurn(bridge, line);
  } catch (error) {
    queuedTurnSubmission = false;
    interruptRequested = false;
    const reason = error instanceof Error ? error.message : String(error);
    tui.appendLine(`turn-error> ${reason}`);
  }
}

async function shutdown(code: number): Promise<void> {
  if (exiting) {
    return;
  }
  exiting = true;

  clearFlushTimer();
  await flushQueue().catch(() => undefined);
  bridge.stop();
  tui.stop();
  process.exit(code);
}

process.on("SIGINT", () => {
  if (turnInFlight) {
    tui.appendLine("system> interrupt requested; sending turn interrupt...");
    interruptTurn(bridge);
    return;
  }
  void shutdown(130);
});

async function main(): Promise<void> {
  tui.start((line) => {
    // Interrupt must bypass queued turn work so it can preempt an in-flight turn.
    if (line === "/interrupt") {
      interruptTurn(bridge);
      return;
    }

    if (!line.startsWith("/")) {
      queuedTurnSubmission = true;
    }

    commandChain = commandChain
      .then(() => handleCommand(line))
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        queuedTurnSubmission = false;
        interruptRequested = false;
        tui.appendLine(`[fatal] ${reason}`);
      });
  });

  tui.appendLine(`[run-id] ${runId}`);
  tui.appendLine(`[convex-url] ${convexUrl}`);
  tui.appendLine(
    `[persist-config] saveStreamDeltas=${String(saveStreamDeltas)} deltaThrottleMs=${String(activeFlushIntervalMs)}`,
  );
  updateStatus();
  await assertHostWiring();
  tui.appendLine("[wiring] validateHostWiring passed");

  await startFlow();
}

void main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  tui.appendLine(`[fatal] ${reason}`);
  void shutdown(1);
});
