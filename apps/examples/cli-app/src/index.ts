import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { CodexLocalBridge } from "@zakstam/codex-runtime-bridge-tauri/local-adapter";
import { extractAssistantDeltaFromPayload, isResponse, isServerNotification } from "../../../shared/protocolPayload.js";
import type {
  ClientNotification,
  ClientRequest,
} from "@zakstam/codex-runtime/protocol";

const model = process.env.CODEX_MODEL ?? null;
const cwd = process.env.CODEX_CWD ?? process.cwd();

let nextId = 1;
let threadId: string | null = null;
let turnId: string | null = null;
let turnInFlight = false;
let turnSettled = false;
let assistantLineOpen = false;

let resolveThreadReady: (() => void) | null = null;
let rejectThreadReady: ((error: Error) => void) | null = null;
let resolveTurnDone: (() => void) | null = null;
let rejectTurnDone: ((error: Error) => void) | null = null;

type PendingRequest = {
  method: string;
};
const pendingRequests = new Map<number, PendingRequest>();

function requestId(): number {
  const id = nextId;
  nextId += 1;
  return id;
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

const bridge = new CodexLocalBridge(
  {
    ...(process.env.CODEX_BIN ? { codexBin: process.env.CODEX_BIN } : {}),
    cwd,
  },
  {
    onEvent: async (event) => {
      if (event.kind === "thread/started" && threadId === null) {
        threadId = event.threadId;
        resolveThreadReady?.();
        resolveThreadReady = null;
        rejectThreadReady = null;
        return;
      }

      if (event.kind === "turn/started" && event.turnId && turnId === null) {
        turnId = event.turnId;
        return;
      }

      if (event.kind === "item/agentMessage/delta") {
        const delta = extractAssistantDeltaFromPayload(event.payloadJson);
        if (!delta) {
          return;
        }
        if (!assistantLineOpen) {
          stdout.write("assistant> ");
          assistantLineOpen = true;
        }
        stdout.write(delta);
        return;
      }

      if (event.kind === "turn/completed") {
        if (!turnInFlight || turnSettled) {
          return;
        }
        turnSettled = true;
        turnInFlight = false;
        turnId = null;
        if (assistantLineOpen) {
          stdout.write("\n");
          assistantLineOpen = false;
        }
        resolveTurnDone?.();
        resolveTurnDone = null;
        rejectTurnDone = null;
        return;
      }
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
              rejectTurnDone?.(error);
              resolveTurnDone = null;
              rejectTurnDone = null;
              return;
            }
            console.error(`[response-error] ${error.message}`);
            return;
          }
        }
        return;
      }

      if (isServerNotification(message)) {
        if (message.method === "error") {
          console.error(`[server-error] ${JSON.stringify(message.params)}`);
          return;
        }
        if (message.method === "account/rateLimits/updated") {
          return;
        }
      }
    },

    onProtocolError: async ({ line, error }) => {
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
      if (turnInFlight && !turnSettled) {
        const error = new Error(`codex app-server exited unexpectedly with code=${String(code)}`);
        rejectTurnDone?.(error);
      }
    },
  },
);

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

async function startFlow(bridge: CodexLocalBridge): Promise<void> {
  bridge.start();

  const initializeRequest: ClientRequest = {
    method: "initialize",
    id: requestId(),
    params: {
      clientInfo: {
        name: "codex_local_cli_example",
        title: "Codex Local CLI Example",
        version: "0.1.0",
      },
      capabilities: null,
    },
  };

  const initialized: ClientNotification = { method: "initialized" };

  const threadStartId = requestId();
  const threadStart: ClientRequest = {
    method: "thread/start",
    id: threadStartId,
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
  console.log(`thread> ready (${threadId})`);
}

async function runRepl(bridge: CodexLocalBridge): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log("Type a message and press Enter.");
  console.log("Commands: /interrupt, /exit");

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
      rl.close();
      break;
    }
    if (line === "/interrupt") {
      interruptTurn(bridge);
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
  bridge.stop();
  process.exit(130);
});

async function main(): Promise<void> {
  console.log(`[run-id] ${randomUUID()}`);
  await startFlow(bridge);
  await runRepl(bridge);
  bridge.stop();
}

void main().catch((error) => {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[fatal] ${reason}`);
  process.exit(1);
});
