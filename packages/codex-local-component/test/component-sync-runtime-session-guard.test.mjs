import test from "node:test";
import assert from "node:assert/strict";

import { resolveRuntimeOptions, syncError } from "../dist/component/syncRuntime.js";
import {
  authzError,
  now,
  requireStreamForActor,
  requireThreadForActor,
  requireThreadRefForActor,
  requireTurnForActor,
  requireTurnRefForActor,
  summarizeInput,
} from "../dist/component/utils.js";

function createDbQueryStub(tableResult) {
  return {
    query: () => ({
      withIndex: () => ({
        filter: () => ({
          first: async () => tableResult,
        }),
      }),
    }),
  };
}

test("resolveRuntimeOptions applies defaults and clamps numeric ranges", () => {
  assert.deepEqual(resolveRuntimeOptions(undefined), {
    saveStreamDeltas: false,
    saveReasoningDeltas: true,
    exposeRawReasoningDeltas: false,
    maxDeltasPerStreamRead: 100,
    maxDeltasPerRequestRead: 1000,
    finishedStreamDeleteDelayMs: 300000,
  });

  assert.deepEqual(
    resolveRuntimeOptions({
      saveStreamDeltas: true,
      maxDeltasPerStreamRead: 0,
      maxDeltasPerRequestRead: 7.4,
      finishedStreamDeleteDelayMs: -20,
      exposeRawReasoningDeltas: true,
    }),
    {
      saveStreamDeltas: true,
      saveReasoningDeltas: true,
      exposeRawReasoningDeltas: true,
      maxDeltasPerStreamRead: 1,
      maxDeltasPerRequestRead: 7,
      finishedStreamDeleteDelayMs: 0,
    },
  );
});

test("syncError throws with a canonical error prefix", () => {
  assert.throws(() => syncError("E_SYNC", "oops"), /\[E_SYNC\] oops/);
});

test("summarizeInput keeps only text entries and truncates to 500 chars", () => {
  const input = [
    { type: "text", text: "one" },
    { type: "image", url: "ignored" },
    { type: "text", text: "two" },
    { type: "text", text: "x".repeat(600) },
  ];
  const summarized = summarizeInput(input);
  assert.equal(summarized, "one\ntwo\n" + "x".repeat(492));
});

test("authzError preserves error code and canonical phrase", () => {
  assert.throws(() => authzError("E_AUTH_SESSION_FORBIDDEN", "must fail"), /\[E_AUTH_SESSION_FORBIDDEN\] authorization failed/);
});

test("requireThreadForActor returns query result", async () => {
  const thread = { _id: "threadRef", threadId: "thread-1", userScope: "u" };
  const ctx = { db: createDbQueryStub(thread) };
  const result = await requireThreadForActor(ctx, { userId: "u" }, "thread-1");
  assert.equal(result.threadId, "thread-1");
  assert.equal(result._id, "threadRef");
});

test("requireThreadForActor reports missing thread", async () => {
  const ctx = { db: createDbQueryStub(null) };
  await assert.rejects(() => requireThreadForActor(ctx, { userId: "u" }, "missing"), /Thread not found for scope: missing/);
});

test("requireThreadRefForActor returns both thread and ref", async () => {
  const thread = { _id: "threadRef", threadId: "thread-1", userScope: "u" };
  const ctx = { db: createDbQueryStub(thread) };
  const result = await requireThreadRefForActor(ctx, { userId: "u" }, "thread-1");
  assert.equal(result.thread._id, "threadRef");
  assert.equal(result.threadRef, "threadRef");
});

test("requireTurnForActor reports missing turn", async () => {
  const ctx = { db: createDbQueryStub(null) };
  await assert.rejects(() => requireTurnForActor(ctx, { userId: "u" }, "thread-1", "turn-1"), /Turn not found: turn-1/);
});

test("requireTurnRefForActor returns both turn and ref", async () => {
  const turn = { _id: "turnRef", turnId: "turn-1", userScope: "u" };
  const ctx = { db: createDbQueryStub(turn) };
  const result = await requireTurnRefForActor(ctx, { userId: "u" }, "thread-1", "turn-1");
  assert.equal(result.turn.turnId, "turn-1");
  assert.equal(result.turnRef, "turnRef");
});

test("requireStreamForActor returns stream when present", async () => {
  const stream = { streamId: "stream-1", userScope: "u" };
  const ctx = { db: createDbQueryStub(stream) };
  const result = await requireStreamForActor(ctx, { userId: "u" }, "stream-1");
  assert.equal(result.streamId, "stream-1");
});

test("now returns increasing timestamps", () => {
  const before = now();
  const after = now();
  assert.equal(before <= after, true);
});
