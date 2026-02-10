import test from "node:test";
import assert from "node:assert/strict";
import { createCodexHostRuntime } from "../dist/host/index.js";

function createHarness() {
  const sent = [];
  let handlers = null;

  const runtime = createCodexHostRuntime({
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
    persistence: {
      ensureThread: async () => ({ threadId: "local-thread", created: true }),
      ensureSession: async () => ({ sessionId: "session", threadId: "local-thread", status: "created" }),
      ingestSafe: async () => ({ status: "ok", errors: [] }),
    },
  });

  const emitResponse = async (response) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onGlobalMessage(response, { scope: "global", kind: "response" });
  };

  return { runtime, sent, emitResponse };
}

test("runtime start supports threadStrategy=resume", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
    threadStrategy: "resume",
    runtimeThreadId: threadId,
  });

  const methods = sent.map((message) => message.method);
  assert.deepEqual(methods, ["initialize", "initialized", "thread/resume"]);

  const resumeRequest = sent.find((message) => message.method === "thread/resume");
  await emitResponse({ id: resumeRequest.id, result: { thread: { id: threadId } } });

  runtime.sendTurn("hello");
  const turnStartRequest = sent.find((message) => message.method === "turn/start");
  assert.equal(turnStartRequest.params.threadId, threadId);

  await runtime.stop();
});

test("runtime thread lifecycle mutations are blocked while turn is in flight", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  runtime.sendTurn("hello");
  await assert.rejects(
    runtime.archiveThread(threadId),
    /Cannot change thread lifecycle while a turn is in flight/,
  );

  await runtime.stop();
});

test("resumeThread updates active runtime thread id after response", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const initialThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";
  const resumedThreadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6b";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: initialThreadId } } });

  const resumePromise = runtime.resumeThread(resumedThreadId);
  const resumeRequest = sent.find((message) => message.method === "thread/resume");
  await emitResponse({ id: resumeRequest.id, result: { thread: { id: resumedThreadId } } });
  await resumePromise;

  runtime.sendTurn("hello");
  const turnStartRequests = sent.filter((message) => message.method === "turn/start");
  assert.equal(turnStartRequests[0].params.threadId, resumedThreadId);

  await runtime.stop();
});
