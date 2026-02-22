import test from "node:test";
import assert from "node:assert/strict";
import { createCodexHostRuntime } from "../dist/host/index.js";

async function waitForMessage(sent, predicate, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const message = sent.find(predicate);
    if (message) {
      return message;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Timed out waiting for message. seen=${sent.map((message) => message.method ?? "<response>").join(",")}`);
}

function createCodexOnlyHarness() {
  const sent = [];
  let handlers = null;

  const runtime = createCodexHostRuntime({
    mode: "codex-only",
    bridgeFactory: (_config, nextHandlers) => {
      handlers = nextHandlers;
      return {
        start: () => undefined,
        stop: () => undefined,
        send: (message) => {
          sent.push(message);
        },
      };
    },
  });

  return {
    runtime,
    sent,
    emitResponse: async (response) => {
      assert.ok(handlers, "bridge handlers not initialized");
      await handlers.onGlobalMessage(response, { scope: "global", kind: "response" });
    },
    emitEvent: async (event) => {
      assert.ok(handlers, "bridge handlers not initialized");
      await handlers.onEvent(event);
    },
  };
}

test("codex-only mode can connect, open thread, and send turn without persistence adapter", async () => {
  const { runtime, sent, emitResponse } = createCodexOnlyHarness();
  const threadId = "thread-codex-only-1";

  await runtime.connect({
    actor: { userId: "u" },
    sessionId: "s",
  });

  const openPromise = runtime.openThread({ strategy: "start" });
  const startRequest = await waitForMessage(sent, (message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });
  await openPromise;
  assert.equal(runtime.getState().runtimeConversationId, threadId);

  const sendResult = await runtime.sendTurn("hello from codex-only");
  assert.equal(sendResult.accepted, true);

  await runtime.stop();
});

test("runtime factory rejects unknown mode", async () => {
  assert.throws(
    () => createCodexHostRuntime({ mode: "invalid-mode" }),
    /Unknown runtime mode/,
  );
});
