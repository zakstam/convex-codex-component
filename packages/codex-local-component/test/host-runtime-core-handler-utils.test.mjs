import test from "node:test";
import assert from "node:assert/strict";

import {
  clearPendingServerRequestRetryTimer,
  enqueuePendingServerRequestRetry,
  flushPendingServerRequestRetries,
  handleBridgeGlobalMessage,
} from "../dist/host/runtimeCoreHandlers.js";
import {
  isManagedServerRequestMethod,
  parseTurnCompletedStatus,
  isResponse,
  isServerNotification,
  isToolRequestUserInputQuestion,
  parseManagedServerRequestFromEvent,
  rewritePayloadTurnId,
  toRequestKey,
} from "../dist/host/runtimeHelpers.js";

function createBaseContext(overrides = {}) {
  const context = {
    actor: { userId: "u" },
    sessionId: "session-1",
    runtimeConversationId: "runtime-thread",
    runtimeThreadId: "runtime-thread",
    threadId: "thread-1",
    turnId: null,
    turnInFlight: false,
    turnSettled: false,
    interruptRequested: false,
    pendingServerRequestRetries: new Map(),
    pendingServerRequestRetryTimer: null,
    flushTimer: null,
    setPendingServerRequestRetryTimer: (value) => {
      context.pendingServerRequestRetryTimer = value;
    },
    setRuntimeThreadFromResponse: () => {},
    resolvePersistedTurnId: (value) => value ?? null,
    ensureThreadBinding: async () => {},
    setTurnId: (value) => {
      context.turnId = value;
    },
    setActiveDispatch: (value) => {
      context.activeDispatch = value;
    },
    processDispatchQueue: async () => {},
    failAcceptedTurnSend: async () => {},
    markTurnDispatchStarted: async () => {},
    markTurnDispatchFailed: async () => {},
    cancelTurnDispatch: async () => {},
    registerPendingServerRequest: async () => {},
    resolvePendingServerRequest: async () => {},
    upsertPendingServerRequest: async () => {},
    emitState: () => {},
    runtimeError: (code, message) => new Error(`[${code}] ${message}`),
    requestIdFn: () => 1,
    sendMessage: () => {},
    clearFlushTimer: () => {},
    setFlushTimer: () => {},
    flushTail: Promise.resolve(),
    setFlushTail: (value) => {
      context.flushTail = value;
    },
    ingestFlushMs: 0,
    ingestQueue: [],
    enqueuedEventCount: 0,
    skippedEventCount: 0,
    incrementEnqueuedKind: () => {},
    incrementSkippedKind: () => {},
    pendingRequests: new Map(),
    persistence: {},
    handlers: {},
    activeDispatch: null,
    ...overrides,
  };
  return context;
}

test("runtime helper request keys and type guards are consistent", () => {
  assert.equal(toRequestKey("abc"), "string:abc");
  assert.equal(toRequestKey(99), "number:99");
  assert.equal(isManagedServerRequestMethod("item/tool/call"), true);
  assert.equal(isManagedServerRequestMethod("thread/start"), false);
  assert.equal(
    isToolRequestUserInputQuestion({
      id: "q1",
      header: "Choose",
      question: "Pick one",
      isOther: false,
      isSecret: false,
      options: null,
    }),
    true,
  );
  assert.equal(
    isToolRequestUserInputQuestion({
      id: "q1",
      header: "Missing fields",
    }),
    false,
  );
  assert.equal(isResponse({ id: "x", result: {} }), true);
  assert.equal(isResponse({ id: "x", method: "x" }), false);
});

test("parseTurnCompletedStatus maps interrupted turn/completed payloads to interrupted", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "turn/completed",
    params: {
      threadId: "thread-1",
      turn: {
        id: "turn-1",
        status: "interrupted",
        error: { message: "cancelled by user" },
      },
    },
  });
  assert.equal(parseTurnCompletedStatus(payload), "interrupted");
});

test("clearPendingServerRequestRetryTimer resets the timer state", () => {
  const fakeTimer = setTimeout(() => {}, 5000);
  const ctx = createBaseContext({
    pendingServerRequestRetryTimer: fakeTimer,
  });
  clearPendingServerRequestRetryTimer(ctx);
  assert.equal(ctx.pendingServerRequestRetryTimer, null);
  clearTimeout(fakeTimer);
});

test("parseManagedServerRequestFromEvent extracts request ids and item ids", () => {
  const commandPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 101,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      reason: "requires approval",
    },
  });
  const commandRequest = parseManagedServerRequestFromEvent({
    type: "stream_delta",
    eventId: "e1",
    turnId: "turn-1",
    streamId: "thread-1:turn-1:0",
    kind: "item/commandExecution/requestApproval",
    payloadJson: commandPayload,
    cursorStart: 0,
    cursorEnd: 1,
    createdAt: 111,
  });
  assert.equal(commandRequest?.method, "item/commandExecution/requestApproval");
  assert.equal(commandRequest?.itemId, "item-1");

  const toolPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: "q2",
    method: "item/tool/call",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "demo",
    },
  });
  const toolRequest = parseManagedServerRequestFromEvent({
    type: "stream_delta",
    eventId: "e2",
    turnId: "turn-1",
    streamId: "thread-1:turn-1:0",
    kind: "item/tool/call",
    payloadJson: toolPayload,
    cursorStart: 0,
    cursorEnd: 1,
    createdAt: 112,
  });
  assert.equal(toolRequest?.itemId, "call-1");
  assert.equal(toolRequest?.method, "item/tool/call");
});

test("parseManagedServerRequestFromEvent validates item/tool/requestUserInput questions", () => {
  const toolPayload = JSON.stringify({
    jsonrpc: "2.0",
    id: 88,
    method: "item/tool/requestUserInput",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "tool-88",
      questions: [{ id: "q1", header: "H", question: "Q?", isOther: true, isSecret: false, options: [] }],
    },
  });
  const request = parseManagedServerRequestFromEvent({
    type: "stream_delta",
    eventId: "e3",
    turnId: "turn-1",
    streamId: "thread-1:turn-1:0",
    kind: "item/tool/requestUserInput",
    payloadJson: toolPayload,
    cursorStart: 0,
    cursorEnd: 1,
    createdAt: 113,
  });
  assert.equal(request?.questions?.length, 1);
});

test("rewritePayloadTurnId rewrites ids in stream events and leaves unsupported envelopes unchanged", () => {
  const rewrittenTurn = rewritePayloadTurnId({
    kind: "turn/started",
    payloadJson: JSON.stringify({
      jsonrpc: "2.0",
      method: "turn/started",
      params: {
        threadId: "thread-1",
        turn: { id: "runtime-turn", status: "inProgress" },
      },
    }),
    runtimeTurnId: "runtime-turn",
    persistedTurnId: "persisted-turn",
  });
  assert.match(rewrittenTurn, /"id":"persisted-turn"/);

  const unchangedUnsupported = rewritePayloadTurnId({
    kind: "unsupported/task_complete",
    payloadJson: JSON.stringify({
      jsonrpc: "2.0",
      method: "unsupported/task_complete",
      params: {
        msg: {
          turnId: "runtime-turn",
        },
      },
    }),
    runtimeTurnId: "runtime-turn",
    persistedTurnId: "persisted-turn",
  });
  assert.match(unchangedUnsupported, /"turnId":"runtime-turn"/);

  const unchanged = rewritePayloadTurnId({
    kind: "item/fileChange/outputDelta",
    payloadJson: "{",
    runtimeTurnId: "runtime-turn",
    persistedTurnId: "persisted-turn",
  });
  assert.equal(unchanged, "{");
});

test("enqueue and flush pending server request retries", async () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 5,
    method: "item/commandExecution/requestApproval",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      itemId: "item-1",
      reason: "check",
    },
  });
  const event = {
    type: "stream_delta",
    eventId: "e5",
    turnId: "turn-1",
    streamId: "thread-1:turn-1:0",
    kind: "item/commandExecution/requestApproval",
    payloadJson: payload,
    cursorStart: 0,
    cursorEnd: 1,
    createdAt: 100,
  };
  const request = parseManagedServerRequestFromEvent(event);
  const calls = [];
  const ctx = createBaseContext({
    actor: { userId: "user-1" },
    pendingServerRequestRetries: new Map(),
    persistence: {
      upsertPendingServerRequest: async ({ request: upserted }) => {
        calls.push({ requestId: upserted.requestId });
      },
    },
    handlers: {},
  });
  enqueuePendingServerRequestRetry(ctx, request, new Error("temporary"));
  await flushPendingServerRequestRetries(ctx);
  assert.equal(calls.length, 1);
  assert.equal(ctx.pendingServerRequestRetries.size, 0);
});

test("handleBridgeGlobalMessage handles thread/start response and pending callbacks", async () => {
  const calls = {
    setRuntimeThreadFromResponse: 0,
    ensureThreadBinding: 0,
    global: 0,
    onMessage: 0,
  };
  const pending = {
    method: "thread/start",
    resolve: () => {
      calls.onMessage += 1;
    },
  };
  const ctx = createBaseContext({
    pendingRequests: new Map([[123, pending]]),
    setRuntimeThreadFromResponse: (message, method) => {
      calls.setRuntimeThreadFromResponse += 1;
      assert.equal(method, "thread/start");
      ctx.runtimeConversationId = message.result?.thread?.id ?? ctx.runtimeConversationId;
    },
    ensureThreadBinding: async (threadId) => {
      calls.ensureThreadBinding += 1;
      assert.equal(threadId, "thread-1");
    },
    handlers: {
      onGlobalMessage: () => {
        calls.global += 1;
      },
    },
    onMessage: (message) => {
      calls.onMessage += 1;
    },
  });

  await handleBridgeGlobalMessage(ctx, {
    id: 123,
    result: {
      thread: { id: "thread-1" },
    },
  });

  assert.equal(ctx.runtimeConversationId, "thread-1");
  assert.equal(calls.setRuntimeThreadFromResponse, 1);
  assert.equal(calls.ensureThreadBinding, 1);
});
