import test from "node:test";
import assert from "node:assert/strict";
import {
  cancelScheduledDeletion,
  createThread,
  deleteThreadCascade,
  deleteTurnCascade,
  forceRunScheduledDeletion,
  getDeletionJobStatus,
  getExternalThreadMapping,
  getThreadState,
  interruptTurn,
  listThreads,
  listPendingApprovals,
  purgeActorCodexData,
  listMessages,
  listReasoningByThread,
  listTurnMessages,
  resolveThread,
  resolveThreadByExternalId,
  respondToApproval,
  resumeStreamReplay,
  resumeThread,
  schedulePurgeActorCodexData,
  scheduleThreadDeleteCascade,
  scheduleTurnDeleteCascade,
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
    actor: { userId: "u" },
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
    actor: { userId: "u" },
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

test("listReasoningByThread passes query reference and args", async () => {
  const listByThread = {};
  const component = {
    reasoning: {
      listByThread,
    },
  };
  const args = {
    actor: { userId: "u" },
    threadId: "thread-1",
    includeRaw: false,
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

  const result = await listReasoningByThread(ctx, component, args);

  assert.equal(result, expected);
  assert.deepEqual(calls, [{ ref: listByThread, queryArgs: args }]);
});

test("startTurn and interruptTurn pass mutation refs and args", async () => {
  const start = {};
  const interrupt = {};
  const component = {
    turns: { start, interrupt },
  };
  const startArgs = {
    actor: { userId: "u" },
    threadId: "thread-1",
    turnId: "turn-1",
    input: [{ type: "text", text: "hello" }],
    idempotencyKey: "idem-1",
  };
  const interruptArgs = {
    actor: { userId: "u" },
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
    actor: { userId: "u" },
    threadId: "thread-1",
    streamCursorsById: [{ streamId: "stream-1", cursor: 0 }],
  };
  const resumeArgs = {
    actor: { userId: "u" },
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
    actor: { userId: "u" },
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

test("thread helpers pass refs and args", async () => {
  const create = {};
  const resolve = {};
  const resume = {};
  const list = {};
  const deleteCascade = {};
  const scheduleDeleteCascade = {};
  const purgeActorData = {};
  const schedulePurgeActorData = {};
  const cancelScheduledDeletionRef = {};
  const forceRunScheduledDeletionRef = {};
  const getDeletionJobStatusRef = {};
  const resolveByExternalId = {};
  const getExternalMapping = {};
  const getState = {};
  const mutationCalls = [];
  const queryCalls = [];
  const mutationCtx = {
    runMutation: async (ref, mutationArgs) => {
      mutationCalls.push({ ref, mutationArgs });
      return { ok: true };
    },
  };
  const queryCtx = {
    runQuery: async (ref, queryArgs) => {
      queryCalls.push({ ref, queryArgs });
      return { ok: true };
    },
  };
  const component = {
    threads: {
      create,
      resolve,
      resume,
      list,
      deleteCascade,
      scheduleDeleteCascade,
      purgeActorData,
      schedulePurgeActorData,
      cancelScheduledDeletion: cancelScheduledDeletionRef,
      forceRunScheduledDeletion: forceRunScheduledDeletionRef,
      getDeletionJobStatus: getDeletionJobStatusRef,
      resolveByExternalId,
      getExternalMapping,
      getState,
    },
  };
  const actor = { userId: "u" };

  await createThread(mutationCtx, component, { actor, threadId: "thread-1" });
  await deleteThreadCascade(mutationCtx, component, { actor, threadId: "thread-1" });
  await scheduleThreadDeleteCascade(mutationCtx, component, { actor, threadId: "thread-1", delayMs: 1000 });
  await purgeActorCodexData(mutationCtx, component, { actor });
  await schedulePurgeActorCodexData(mutationCtx, component, { actor, delayMs: 1000 });
  await cancelScheduledDeletion(mutationCtx, component, { actor, deletionJobId: "job-1" });
  await forceRunScheduledDeletion(mutationCtx, component, { actor, deletionJobId: "job-2" });
  await resolveThread(mutationCtx, component, { actor, externalThreadId: "external-1" });
  await resumeThread(mutationCtx, component, { actor, threadId: "thread-1" });
  await getDeletionJobStatus(queryCtx, component, { actor, deletionJobId: "job-1" });
  await listThreads(queryCtx, component, { actor, paginationOpts: { cursor: null, numItems: 10 } });
  await resolveThreadByExternalId(queryCtx, component, { actor, externalThreadId: "external-1" });
  await getExternalThreadMapping(queryCtx, component, { actor, threadId: "thread-1" });
  await getThreadState(queryCtx, component, { actor, threadId: "thread-1" });

  assert.equal(mutationCalls.length, 9);
  assert.equal(queryCalls.length, 5);
  assert.equal(mutationCalls[0].ref, create);
  assert.equal(mutationCalls[1].ref, deleteCascade);
  assert.equal(mutationCalls[2].ref, scheduleDeleteCascade);
  assert.equal(mutationCalls[3].ref, purgeActorData);
  assert.equal(mutationCalls[4].ref, schedulePurgeActorData);
  assert.equal(mutationCalls[5].ref, cancelScheduledDeletionRef);
  assert.equal(mutationCalls[6].ref, forceRunScheduledDeletionRef);
  assert.equal(mutationCalls[7].ref, resolve);
  assert.equal(mutationCalls[8].ref, resume);
  assert.equal(queryCalls[0].ref, getDeletionJobStatusRef);
  assert.equal(queryCalls[1].ref, list);
  assert.equal(queryCalls[2].ref, resolveByExternalId);
  assert.equal(queryCalls[3].ref, getExternalMapping);
  assert.equal(queryCalls[4].ref, getState);
});

test("deleteTurnCascade passes mutation ref and args", async () => {
  const deleteCascade = {};
  const scheduleDeleteCascade = {};
  const component = {
    turns: { deleteCascade, scheduleDeleteCascade },
  };
  const args = {
    actor: { userId: "u" },
    threadId: "thread-1",
    turnId: "turn-1",
  };
  const calls = [];
  const ctx = {
    runMutation: async (ref, mutationArgs) => {
      calls.push({ ref, mutationArgs });
      return { deletionJobId: "job-1" };
    },
  };

  const result = await deleteTurnCascade(ctx, component, args);
  const scheduled = await scheduleTurnDeleteCascade(ctx, component, { ...args, delayMs: 1000 });

  assert.deepEqual(result, { deletionJobId: "job-1" });
  assert.deepEqual(scheduled, { deletionJobId: "job-1" });
  assert.deepEqual(calls, [
    { ref: deleteCascade, mutationArgs: args },
    { ref: scheduleDeleteCascade, mutationArgs: { ...args, delayMs: 1000 } },
  ]);
});

test("approval helpers pass refs and args", async () => {
  const listPending = {};
  const respond = {};
  const component = {
    approvals: { listPending, respond },
  };
  const listArgs = {
    actor: { userId: "u" },
    threadId: "thread-1",
    paginationOpts: { cursor: null, numItems: 10 },
  };
  const respondArgs = {
    actor: { userId: "u" },
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
