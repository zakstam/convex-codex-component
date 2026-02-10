import test from "node:test";
import assert from "node:assert/strict";
import {
  getThreadState,
  interruptTurn,
  listPendingApprovals,
  listMessages,
  listTurnMessages,
  respondToApproval,
  resumeStreamReplay,
  startTurn,
  replayStreams,
} from "../dist/client/index.js";

test("listMessages passes query reference and args", async () => {
  const listByThread = {};
  const component = {
    messages: {
      listByThread,
      getByTurn: {},
    },
  };
  const args = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    paginationOpts: { cursor: null, numItems: 10 },
  };
  const expected = { page: [], isDone: true, continueCursor: "" };
  const calls = [];
  const ctx = {
    runQuery: async (ref, queryArgs) => {
      calls.push({ ref, queryArgs });
      return expected;
    },
  };

  const result = await listMessages(ctx, component, args);

  assert.equal(result, expected);
  assert.deepEqual(calls, [{ ref: listByThread, queryArgs: args }]);
});

test("listTurnMessages passes query reference and args", async () => {
  const getByTurn = {};
  const component = {
    messages: {
      listByThread: {},
      getByTurn,
    },
  };
  const args = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    turnId: "turn-1",
  };
  const expected = [{ messageId: "m-1" }];
  const calls = [];
  const ctx = {
    runQuery: async (ref, queryArgs) => {
      calls.push({ ref, queryArgs });
      return expected;
    },
  };

  const result = await listTurnMessages(ctx, component, args);

  assert.equal(result, expected);
  assert.deepEqual(calls, [{ ref: getByTurn, queryArgs: args }]);
});

test("startTurn and interruptTurn pass mutation refs and args", async () => {
  const start = {};
  const interrupt = {};
  const component = {
    turns: { start, interrupt },
  };
  const startArgs = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    turnId: "turn-1",
    input: [{ type: "text", text: "hello" }],
    idempotencyKey: "idem-1",
  };
  const interruptArgs = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    turnId: "turn-1",
    reason: "stop",
  };
  const calls = [];
  const ctx = {
    runMutation: async (ref, mutationArgs) => {
      calls.push({ ref, mutationArgs });
      return ref === start ? { accepted: true } : null;
    },
  };

  const started = await startTurn(ctx, component, startArgs);
  const interrupted = await interruptTurn(ctx, component, interruptArgs);

  assert.deepEqual(started, { accepted: true });
  assert.equal(interrupted, null);
  assert.deepEqual(calls, [
    { ref: start, mutationArgs: startArgs },
    { ref: interrupt, mutationArgs: interruptArgs },
  ]);
});

test("replayStreams and resumeStreamReplay pass query refs and args", async () => {
  const replay = {};
  const resumeReplay = {};
  const component = {
    sync: { replay, resumeReplay },
  };
  const syncArgs = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    streamCursorsById: [{ streamId: "stream-1", cursor: 0 }],
  };
  const resumeArgs = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    turnId: "turn-1",
    fromCursor: 0,
  };
  const calls = [];
  const ctx = {
    runQuery: async (ref, queryArgs) => {
      calls.push({ ref, queryArgs });
      return ref === replay ? { streams: [] } : { deltas: [], nextCursor: 0 };
    },
  };

  const syncResult = await replayStreams(ctx, component, syncArgs);
  const resumeResult = await resumeStreamReplay(ctx, component, resumeArgs);

  assert.deepEqual(syncResult, { streams: [] });
  assert.deepEqual(resumeResult, { deltas: [], nextCursor: 0 });
  assert.deepEqual(calls, [
    { ref: replay, queryArgs: syncArgs },
    { ref: resumeReplay, queryArgs: resumeArgs },
  ]);
});

test("getThreadState passes query reference and args", async () => {
  const getState = {};
  const component = {
    threads: { getState },
  };
  const args = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
  };
  const expected = { threadId: "thread-1", turns: [] };
  const calls = [];
  const ctx = {
    runQuery: async (ref, queryArgs) => {
      calls.push({ ref, queryArgs });
      return expected;
    },
  };

  const result = await getThreadState(ctx, component, args);

  assert.equal(result, expected);
  assert.deepEqual(calls, [{ ref: getState, queryArgs: args }]);
});

test("approval helpers pass refs and args", async () => {
  const listPending = {};
  const respond = {};
  const component = {
    approvals: { listPending, respond },
  };
  const listArgs = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    paginationOpts: { cursor: null, numItems: 10 },
  };
  const respondArgs = {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    decision: "accepted",
  };
  const queryCalls = [];
  const mutationCalls = [];
  const queryCtx = {
    runQuery: async (ref, queryArgs) => {
      queryCalls.push({ ref, queryArgs });
      return { page: [], isDone: true, continueCursor: "" };
    },
  };
  const mutationCtx = {
    runMutation: async (ref, mutationArgs) => {
      mutationCalls.push({ ref, mutationArgs });
      return null;
    },
  };

  const listed = await listPendingApprovals(queryCtx, component, listArgs);
  const responded = await respondToApproval(mutationCtx, component, respondArgs);

  assert.deepEqual(listed, { page: [], isDone: true, continueCursor: "" });
  assert.equal(responded, null);
  assert.deepEqual(queryCalls, [{ ref: listPending, queryArgs: listArgs }]);
  assert.deepEqual(mutationCalls, [{ ref: respond, mutationArgs: respondArgs }]);
});
