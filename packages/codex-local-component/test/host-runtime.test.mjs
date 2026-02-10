import test from "node:test";
import assert from "node:assert/strict";
import { createCodexHostRuntime } from "../dist/host/index.js";

function createHarness() {
  const sent = [];
  let handlers = null;
  const upserted = [];
  const resolved = [];

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
      upsertPendingServerRequest: async ({ request }) => {
        upserted.push(request);
      },
      resolvePendingServerRequest: async (args) => {
        resolved.push(args);
      },
    },
  });

  const emitResponse = async (response) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onGlobalMessage(response, { scope: "global", kind: "response" });
  };

  const emitEvent = async (event) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onEvent(event);
  };

  return { runtime, sent, emitResponse, emitEvent, upserted, resolved };
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

test("runtime start forwards dynamicTools in thread/start", async () => {
  const { runtime, sent } = createHarness();

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
    dynamicTools: [
      {
        name: "search_docs",
        description: "Search internal docs",
        inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    ],
  });

  const startRequest = sent.find((message) => message.method === "thread/start");
  assert.equal(startRequest.params.dynamicTools?.[0]?.name, "search_docs");
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

test("respondCommandApproval sends JSON-RPC response for pending command approval request", async () => {
  const { runtime, sent, emitResponse, emitEvent, upserted, resolved } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-1",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/commandExecution/requestApproval",
    payloadJson: JSON.stringify({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId: "turn-1",
        itemId: "cmd-1",
        reason: "network required",
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].requestId, 99);
  assert.equal(runtime.getState().pendingServerRequestCount, 1);

  await runtime.respondCommandApproval({
    requestId: 99,
    decision: "accept",
  });

  const responseMessage = sent.find((message) => message.id === 99 && "result" in message);
  assert.deepEqual(responseMessage, {
    id: 99,
    result: {
      decision: "accept",
    },
  });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].status, "answered");
  assert.equal(runtime.getState().pendingServerRequestCount, 0);

  await runtime.stop();
});

test("respondToolUserInput rejects unknown request id", async () => {
  const { runtime } = createHarness();
  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });

  await assert.rejects(
    runtime.respondToolUserInput({
      requestId: "missing",
      answers: { q1: { answers: ["A"] } },
    }),
    /No pending server request found/,
  );

  await runtime.stop();
});

test("respondDynamicToolCall responds to pending item/tool/call request", async () => {
  const { runtime, sent, emitResponse, emitEvent, upserted, resolved } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-tool-call-1",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "item/tool/call",
    payloadJson: JSON.stringify({
      id: 201,
      method: "item/tool/call",
      params: {
        threadId,
        turnId: "turn-1",
        callId: "call-1",
        tool: "search_docs",
        arguments: { query: "hello" },
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(upserted.length, 1);
  assert.equal(upserted[0].method, "item/tool/call");
  assert.equal(upserted[0].itemId, "call-1");

  await runtime.respondDynamicToolCall({
    requestId: 201,
    success: true,
    contentItems: [{ type: "inputText", text: "result" }],
  });

  const responseMessage = sent.find((message) => message.id === 201 && "result" in message);
  assert.deepEqual(responseMessage, {
    id: 201,
    result: {
      success: true,
      contentItems: [{ type: "inputText", text: "result" }],
    },
  });
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].status, "answered");

  await runtime.stop();
});
