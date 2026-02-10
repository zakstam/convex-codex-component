import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDataHygiene,
  computeDurableHistoryStats,
  computePersistenceStats,
  ensureThreadByCreate,
  ingestBatchMixed,
  listPendingServerRequestsForHooksWithTrustedActor,
  listThreadMessagesForHooks,
  resolvePendingServerRequestForHooksWithTrustedActor,
  upsertPendingServerRequestForHooksWithTrustedActor,
} from "../dist/host/index.js";

test("ensureThreadByCreate writes localThreadId and threadId", async () => {
  const createRef = {};
  const calls = [];
  const ctx = {
    runMutation: async (ref, args) => {
      calls.push({ ref, args });
      return { ok: true };
    },
  };
  const component = {
    threads: {
      create: createRef,
    },
  };

  await ensureThreadByCreate(ctx, component, {
    actor: { tenantId: "ignored", userId: "ignored", deviceId: "ignored" },
    threadId: "thread-1",
    model: "m",
    cwd: "/tmp",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref, createRef);
  assert.equal(calls[0].args.threadId, "thread-1");
  assert.equal(calls[0].args.localThreadId, "thread-1");
  assert.equal(calls[0].args.model, "m");
  assert.equal(calls[0].args.cwd, "/tmp");
  assert.equal(typeof calls[0].args.actor.tenantId, "string");
  assert.equal(typeof calls[0].args.actor.userId, "string");
  assert.equal(typeof calls[0].args.actor.deviceId, "string");
});

test("ingestBatchMixed forwards stream and lifecycle events", async () => {
  const ingestSafeRef = {};
  const calls = [];
  const ctx = {
    runMutation: async (ref, args) => {
      calls.push({ ref, args });
      return { status: "ok" };
    },
  };
  const component = {
    sync: {
      ingestSafe: ingestSafeRef,
    },
  };

  const result = await ingestBatchMixed(ctx, component, {
    actor: { tenantId: "ignored", userId: "ignored", deviceId: "ignored" },
    sessionId: "session-1",
    threadId: "thread-1",
    deltas: [
      {
        type: "stream_delta",
        eventId: "e1",
        turnId: "turn-1",
        streamId: "stream-1",
        kind: "item/agentMessage/delta",
        payloadJson: "{}",
        cursorStart: 0,
        cursorEnd: 1,
        createdAt: 1,
      },
      {
        type: "lifecycle_event",
        eventId: "e2",
        turnId: "turn-1",
        kind: "turn/completed",
        payloadJson: "{}",
        createdAt: 2,
      },
    ],
  });

  assert.deepEqual(result, { status: "ok" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].ref, ingestSafeRef);
  assert.equal(calls[0].args.streamDeltas.length, 1);
  assert.equal(calls[0].args.lifecycleEvents.length, 1);
});

test("computePersistenceStats filters invalid stream rows", () => {
  const stats = computePersistenceStats({
    streamStats: [
      { streamId: "stream-1", deltaCount: 2, latestCursor: 4 },
      { bad: true },
    ],
  });

  assert.deepEqual(stats, {
    streamCount: 1,
    deltaCount: 2,
    latestCursorByStream: [{ streamId: "stream-1", cursor: 4 }],
  });
});

test("computeDurableHistoryStats keeps latest five messages", () => {
  const history = computeDurableHistoryStats({
    recentMessages: [
      { messageId: "m1", turnId: "t", role: "assistant", status: "completed", text: "1" },
      { messageId: "m2", turnId: "t", role: "assistant", status: "completed", text: "2" },
      { messageId: "m3", turnId: "t", role: "assistant", status: "completed", text: "3" },
      { messageId: "m4", turnId: "t", role: "assistant", status: "completed", text: "4" },
      { messageId: "m5", turnId: "t", role: "assistant", status: "completed", text: "5" },
      { messageId: "m6", turnId: "t", role: "assistant", status: "completed", text: "6" },
    ],
  });

  assert.equal(history.messageCountInPage, 6);
  assert.equal(history.latest.length, 5);
  assert.equal(history.latest[0].messageId, "m1");
  assert.equal(history.latest[4].messageId, "m5");
});

test("computeDataHygiene detects orphan stream stats", () => {
  const hygiene = computeDataHygiene({
    streamStats: [
      { streamId: "stream-live", deltaCount: 1, latestCursor: 1 },
      { streamId: "stream-orphan", deltaCount: 1, latestCursor: 1 },
      { bad: true },
    ],
    allStreams: [{ streamId: "stream-live" }],
  });

  assert.deepEqual(hygiene, {
    scannedStreamStats: 2,
    streamStatOrphans: 1,
    orphanStreamIds: ["stream-orphan"],
  });
});

test("listThreadMessagesForHooks returns stream list with deltas payload", async () => {
  const listByThreadRef = {};
  const replayRef = {};
  const component = {
    messages: {
      listByThread: listByThreadRef,
    },
    sync: {
      replay: replayRef,
    },
  };

  const ctx = {
    runQuery: async (ref) => {
      if (ref === listByThreadRef) {
        return { page: [], continueCursor: "", isDone: true };
      }
      return {
        streams: [{ streamId: "stream-1", state: "streaming" }],
        deltas: [],
        streamWindows: [],
        nextCheckpoints: [],
      };
    },
  };

  const result = await listThreadMessagesForHooks(ctx, component, {
    actor: { tenantId: "t", userId: "u", deviceId: "d" },
    threadId: "thread-1",
    paginationOpts: { cursor: null, numItems: 10 },
    streamArgs: { kind: "deltas", cursors: [] },
  });

  assert.equal(result.streams?.kind, "deltas");
  assert.deepEqual(result.streams?.streams, [{ streamId: "stream-1", state: "streaming" }]);
});

test("server request host wrappers pass refs and args", async () => {
  const listRef = {};
  const upsertRef = {};
  const resolveRef = {};
  const queryCalls = [];
  const mutationCalls = [];

  const queryCtx = {
    runQuery: async (ref, args) => {
      queryCalls.push({ ref, args });
      return [];
    },
  };
  const mutationCtx = {
    runMutation: async (ref, args) => {
      mutationCalls.push({ ref, args });
      return null;
    },
  };
  const component = {
    serverRequests: {
      listPending: listRef,
      upsertPending: upsertRef,
      resolve: resolveRef,
    },
  };
  const actor = { tenantId: "actor-tenant", userId: "actor-user", deviceId: "actor-device" };

  await listPendingServerRequestsForHooksWithTrustedActor(queryCtx, component, {
    actor,
    threadId: "thread-1",
    limit: 20,
  });
  await upsertPendingServerRequestForHooksWithTrustedActor(mutationCtx, component, {
    actor,
    requestId: 1,
    threadId: "thread-1",
    turnId: "turn-1",
    itemId: "item-1",
    method: "item/commandExecution/requestApproval",
    payloadJson: "{}",
    requestedAt: 1,
  });
  await resolvePendingServerRequestForHooksWithTrustedActor(mutationCtx, component, {
    actor,
    threadId: "thread-1",
    requestId: 1,
    status: "answered",
    resolvedAt: 2,
    responseJson: "{\"decision\":\"accept\"}",
  });

  assert.equal(queryCalls.length, 1);
  assert.equal(queryCalls[0].ref, listRef);
  assert.equal(queryCalls[0].args.threadId, "thread-1");
  assert.equal(typeof queryCalls[0].args.actor.tenantId, "string");
  assert.equal(mutationCalls.length, 2);
  assert.equal(mutationCalls[0].ref, upsertRef);
  assert.equal(mutationCalls[1].ref, resolveRef);
  assert.equal(typeof mutationCalls[0].args.actor.tenantId, "string");
  assert.equal(typeof mutationCalls[1].args.actor.tenantId, "string");
});
