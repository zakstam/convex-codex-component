import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { ConvexHttpClient } from "convex/browser";
import { CodexLocalBridge } from "@zakstam/codex-local-component/bridge";
import type {
  CodexResponse,
  NormalizedEvent,
  ServerInboundMessage,
  ClientNotification,
  ClientRequest,
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
const ACTIVE_FLUSH_INTERVAL_MS = 250;
const IDLE_FLUSH_INTERVAL_MS = 5000;

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
    return message.params.delta;
  }
  return null;
}

const convexUrl = resolveConvexUrl();
if (!convexUrl) {
  console.error(
    "Missing Convex URL. Run `pnpm run dev:convex` first, or set CONVEX_URL explicitly.",
  );
  process.exit(1);
}

const model = process.env.CODEX_MODEL ?? null;
const cwd = process.env.CODEX_CWD ?? process.cwd();

const actor = {
  tenantId: process.env.ACTOR_TENANT_ID ?? "demo-tenant",
  userId: process.env.ACTOR_USER_ID ?? "demo-user",
  deviceId: process.env.ACTOR_DEVICE_ID ?? `device-${process.pid}`,
};

const convex = new ConvexHttpClient(convexUrl);
const sessionId = randomUUID();

let nextId = 1;
let threadId: string | null = null;
let turnId: string | null = null;
let turnInFlight = false;
let turnSettled = false;
let assistantLineOpen = false;
let pendingTurn: { inputText: string; idempotencyKey: string } | null = null;
let restoreSuppressedTyping: (() => void) | null = null;

let resolveThreadReady: (() => void) | null = null;
let rejectThreadReady: ((error: Error) => void) | null = null;
let resolveTurnDone: (() => void) | null = null;
let rejectTurnDone: ((error: Error) => void) | null = null;

type PendingRequest = { method: string };
const pendingRequests = new Map<number, PendingRequest>();

let eventChain: Promise<void> = Promise.resolve();
let ingestQueue: IngestDelta[] = [];
let flushTimer: NodeJS.Timeout | null = null;
let flushTail: Promise<void> = Promise.resolve();

function requestId(): number {
  const id = nextId;
  nextId += 1;
  return id;
}

function suppressTypingWhileTurnInFlight(): void {
  if (!stdin.isTTY || restoreSuppressedTyping || typeof stdin.setRawMode !== "function") {
    return;
  }

  const swallow = () => {};
  stdin.setRawMode(true);
  stdin.on("data", swallow);
  stdin.resume();

  restoreSuppressedTyping = () => {
    stdin.off("data", swallow);
    stdin.setRawMode(false);
  };
}

function resumeTyping(): void {
  if (!restoreSuppressedTyping) {
    return;
  }
  restoreSuppressedTyping();
  restoreSuppressedTyping = null;
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

async function flushQueue(): Promise<void> {
  const next = flushTail.then(async () => {
    clearFlushTimer();
    while (ingestQueue.length > 0) {
      const batch = ingestQueue.splice(0, MAX_BATCH_SIZE);
      const first = batch[0];
      if (!first) {
        return;
      }
      await convex.mutation(api.chat.ingestBatch, {
        actor,
        sessionId,
        threadId: first.threadId,
        deltas: batch.map((delta) => ({
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
  ingestQueue.push(delta);

  if (forceFlush || ingestQueue.length >= MAX_BATCH_SIZE) {
    return flushQueue();
  }

  if (!flushTimer) {
    const intervalMs = turnInFlight ? ACTIVE_FLUSH_INTERVAL_MS : IDLE_FLUSH_INTERVAL_MS;
    flushTimer = setTimeout(() => {
      void flushQueue().catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[persist-flush-error] ${reason}`);
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
  const activeThreadId = threadId;
  if (turnInFlight) {
    throw new Error("A turn is already in progress. Wait for completion or run /interrupt.");
  }

  turnInFlight = true;
  turnSettled = false;
  turnId = null;
  assistantLineOpen = false;
  suppressTypingWhileTurnInFlight();

  pendingTurn = {
    inputText: text,
    idempotencyKey: randomUUID(),
  };

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
  if (!threadId || !turnId || !turnInFlight) {
    console.log("No active turn to interrupt.");
    return;
  }

  const interruptReq: ClientRequest = {
    method: "turn/interrupt",
    id: requestId(),
    params: { threadId, turnId },
  };
  sendMessage(bridge, interruptReq, "turn/interrupt");
}

async function logPersistenceStats(): Promise<void> {
  if (!threadId) {
    return;
  }
  const stats = await convex.query(api.chat.persistenceStats, {
    actor,
    threadId,
  });
  console.log(`persisted> streams=${stats.streamCount} deltas=${stats.deltaCount}`);
}

function requiresTurnContext(kind: string): boolean {
  return kind.startsWith("turn/") || kind.startsWith("item/");
}

function toIngestDelta(event: NormalizedEvent): IngestDelta | null {
  const resolvedTurnId = event.turnId ?? turnId;
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
    await convex.mutation(api.chat.ensureThread, {
      actor,
      threadId,
      ...(model !== null ? { model } : {}),
      cwd,
    });
    resolveThreadReady?.();
    resolveThreadReady = null;
    rejectThreadReady = null;
  }

  const payload = JSON.parse(event.payloadJson) as ServerInboundMessage;
  const delta = extractAssistantDelta(payload);
  if (delta) {
    if (!assistantLineOpen) {
      stdout.write("assistant> ");
      assistantLineOpen = true;
    }
    stdout.write(delta);
  }

  if (event.kind === "turn/started" && event.turnId) {
    turnId = event.turnId;
    if (pendingTurn && threadId) {
      await convex.mutation(api.chat.registerTurnStart, {
        actor,
        threadId,
        turnId: event.turnId,
        inputText: pendingTurn.inputText,
        idempotencyKey: pendingTurn.idempotencyKey,
        ...(model !== null ? { model } : {}),
        cwd,
      });
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
    pendingTurn = null;
    resumeTyping();

    await flushQueue();

    if (assistantLineOpen) {
      stdout.write("\n");
      assistantLineOpen = false;
    }

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
              pendingTurn = null;
              resumeTyping();
              rejectTurnDone?.(error);
              resolveTurnDone = null;
              rejectTurnDone = null;
              return;
            }

            console.error(`[response-error] ${error.message}`);
          }
        }
        return;
      }

      if (isServerNotification(message) && message.method === "error") {
        console.error(`[server-error] ${JSON.stringify(message.params)}`);
      }
    },

    onProtocolError: async ({ line, error }) => {
      resumeTyping();
      if (assistantLineOpen) {
        stdout.write("\n");
      }
      console.error(`[protocol-error] ${error.message}`);
      console.error(`[protocol-error-line] ${line}`);
      rejectThreadReady?.(error);
      rejectTurnDone?.(error);
      bridge.stop();
      process.exit(1);
    },

    onProcessExit: (code) => {
      resumeTyping();
      if (turnInFlight && !turnSettled) {
        const error = new Error(`codex app-server exited unexpectedly with code=${String(code)}`);
        rejectTurnDone?.(error);
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
        name: "codex_local_persistent_cli_example",
        title: "Codex Local Persistent CLI Example",
        version: "0.1.0",
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
    await convex.mutation(api.chat.ensureSession, {
      actor,
      sessionId,
      threadId,
    });
  }
  console.log(`thread> ready (${threadId}) session=${sessionId}`);
  await logPersistenceStats();
}

async function runRepl(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("Type a message and press Enter.");
  console.log("Commands: /interrupt, /state, /exit");

  while (true) {
    let line = "";
    try {
      line = (await rl.question("you> ")).trim();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason.includes("readline was closed")) {
        rl.close();
        break;
      }
      throw error;
    }

    if (!line) {
      continue;
    }

    if (line === "/exit") {
      resumeTyping();
      rl.close();
      break;
    }

    if (line === "/interrupt") {
      interruptTurn(bridge);
      continue;
    }

    if (line === "/state") {
      if (!threadId) {
        console.log("state> no thread yet");
        continue;
      }
      const state = await convex.query(api.chat.threadSnapshot, {
        actor,
        threadId,
      });
      const stats = await convex.query(api.chat.persistenceStats, {
        actor,
        threadId,
      });
      console.log(
        `state> thread=${state.threadId} turns=${state.turns.length} activeStreams=${state.activeStreams.length} pendingApprovals=${state.pendingApprovals.length} deltas=${stats.deltaCount}`,
      );
      continue;
    }

    try {
      await runTurn(bridge, line);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`turn-error> ${reason}`);
    }
  }
}

process.on("SIGINT", () => {
  if (turnInFlight) {
    console.log("\nInterrupt requested; sending turn interrupt...");
    interruptTurn(bridge);
    return;
  }
  console.log("\nStopping bridge");
  void flushQueue().finally(() => {
    resumeTyping();
    bridge.stop();
    process.exit(130);
  });
});

async function main(): Promise<void> {
  console.log(`[run-id] ${randomUUID()}`);
  console.log(`[convex-url] ${convexUrl}`);
  await startFlow();
  await runRepl();
  await flushQueue();
  resumeTyping();
  bridge.stop();
}

void main().catch((error) => {
  resumeTyping();
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[fatal] ${reason}`);
  process.exit(1);
});
