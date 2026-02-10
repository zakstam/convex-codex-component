import test from "node:test";
import assert from "node:assert/strict";
import { createCodexHostRuntime } from "../dist/host/index.js";

function createHarness() {
  const sent = [];
  let handlers = null;
  const upserted = [];
  const resolved = [];
  const ingestCalls = [];

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
      ingestSafe: async (args) => {
        ingestCalls.push(args);
        return { status: "ok", errors: [] };
      },
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

  const emitGlobalMessage = async (message) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onGlobalMessage(message, { scope: "global", kind: "message" });
  };

  const emitEvent = async (event) => {
    assert.ok(handlers, "bridge handlers not initialized");
    await handlers.onEvent(event);
  };

  return { runtime, sent, emitResponse, emitGlobalMessage, emitEvent, upserted, resolved, ingestCalls };
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

test("runtime ignores non-turn thread-scoped events for ingest", async () => {
  const { runtime, sent, emitResponse, emitEvent, ingestCalls } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-thread-started",
    threadId,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "thread/started",
    payloadJson: JSON.stringify({
      method: "thread/started",
      params: { thread: { id: threadId } },
    }),
    createdAt: Date.now(),
  });

  assert.equal(ingestCalls.length, 0);
  const state = runtime.getState();
  assert.equal(state.ingestMetrics.enqueuedEventCount, 0);
  assert.equal(state.ingestMetrics.skippedEventCount, 1);
  assert.deepEqual(state.ingestMetrics.skippedByKind, [{ kind: "thread/started", count: 1 }]);
  await runtime.stop();
});

test("runtime ingests turn-scoped events", async () => {
  const { runtime, sent, emitResponse, emitEvent, ingestCalls } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  await emitEvent({
    eventId: "evt-turn-completed",
    threadId,
    turnId: "turn-1",
    streamId: `${threadId}:turn-1:0`,
    cursorStart: 0,
    cursorEnd: 1,
    kind: "turn/completed",
    payloadJson: JSON.stringify({
      method: "turn/completed",
      params: {
        threadId,
        turn: { id: "turn-1", items: [], status: "completed", error: null },
      },
    }),
    createdAt: Date.now(),
  });

  assert.equal(ingestCalls.length, 1);
  assert.equal(ingestCalls[0].deltas.length, 1);
  assert.equal(ingestCalls[0].deltas[0].type, "stream_delta");
  const state = runtime.getState();
  assert.equal(state.ingestMetrics.enqueuedEventCount, 1);
  assert.equal(state.ingestMetrics.skippedEventCount, 0);
  assert.deepEqual(state.ingestMetrics.enqueuedByKind, [{ kind: "turn/completed", count: 1 }]);

  await runtime.stop();
});

test("runtime account/auth helper methods send account requests and resolve responses", async () => {
  const { runtime, sent, emitResponse } = createHarness();
  const threadId = "018f5f3b-5b7a-7c9d-a12b-3d0f3e4c5b6a";

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });
  const startRequest = sent.find((message) => message.method === "thread/start");
  await emitResponse({ id: startRequest.id, result: { thread: { id: threadId } } });

  const readAccountPromise = runtime.readAccount({ refreshToken: true });
  const readAccountRequest = sent.find((message) => message.method === "account/read");
  await emitResponse({
    id: readAccountRequest.id,
    result: { account: null, requiresOpenaiAuth: true },
  });
  await readAccountPromise;

  const loginPromise = runtime.loginAccount({ type: "apiKey", apiKey: "sk-test" });
  const loginRequest = sent.find((message) => message.method === "account/login/start");
  await emitResponse({ id: loginRequest.id, result: { type: "apiKey" } });
  await loginPromise;

  const cancelPromise = runtime.cancelAccountLogin({ loginId: "login-1" });
  const cancelRequest = sent.find((message) => message.method === "account/login/cancel");
  await emitResponse({ id: cancelRequest.id, result: { status: "canceled" } });
  await cancelPromise;

  const logoutPromise = runtime.logoutAccount();
  const logoutRequest = sent.find((message) => message.method === "account/logout");
  await emitResponse({ id: logoutRequest.id, result: {} });
  await logoutPromise;

  const rateLimitPromise = runtime.readAccountRateLimits();
  const rateLimitRequest = sent.find((message) => message.method === "account/rateLimits/read");
  await emitResponse({ id: rateLimitRequest.id, result: { rateLimits: {} } });
  await rateLimitPromise;

  assert.equal(readAccountRequest.params.refreshToken, true);
  assert.equal(logoutRequest.params, undefined);
  assert.equal(rateLimitRequest.params, undefined);

  await runtime.stop();
});

test("respondChatgptAuthTokensRefresh responds to pending auth token refresh request", async () => {
  const { runtime, sent, emitGlobalMessage } = createHarness();

  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });

  await emitGlobalMessage({
    method: "account/chatgptAuthTokens/refresh",
    id: 501,
    params: { reason: "unauthorized", previousAccountId: "acct_123" },
  });

  await runtime.respondChatgptAuthTokensRefresh({
    requestId: 501,
    idToken: "id-token",
    accessToken: "access-token",
  });

  const responseMessage = sent.find((message) => message.id === 501 && "result" in message);
  assert.deepEqual(responseMessage, {
    id: 501,
    result: {
      idToken: "id-token",
      accessToken: "access-token",
    },
  });

  await runtime.stop();
});

test("respondChatgptAuthTokensRefresh rejects unknown request id", async () => {
  const { runtime } = createHarness();
  await runtime.start({
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    sessionId: "s",
  });

  await assert.rejects(
    runtime.respondChatgptAuthTokensRefresh({
      requestId: "missing",
      idToken: "id-token",
      accessToken: "access-token",
    }),
    /No pending auth token refresh request found/,
  );

  await runtime.stop();
});
