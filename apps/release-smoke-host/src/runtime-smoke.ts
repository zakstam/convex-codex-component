import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { resolveConvexUrl } from "./smoke-env.js";

async function main(): Promise<void> {
  const convexUrl = resolveConvexUrl();
  assert.ok(convexUrl, "Missing Convex URL. Run `pnpm run dev:convex:once` first.");

  const convex = new ConvexHttpClient(convexUrl);
  const suffix = randomUUID();
  const actor = {
    tenantId: "runtime-smoke-tenant",
    userId: "runtime-smoke-user",
    deviceId: `runtime-smoke-device-${suffix}`,
  };
  const threadId = `runtime-smoke-thread-${suffix}`;
  const turnId = `runtime-smoke-turn-${suffix}`;
  const runtimeTurnId = `runtime-smoke-runtime-turn-${suffix}`;
  const runtimeThreadId = `runtime-smoke-runtime-thread-${suffix}`;
  const streamId = `runtime-smoke-stream-${suffix}`;
  const sessionId = randomUUID();
  const now = Date.now();

  await convex.mutation(api.chat.ensureThread, {
    actor,
    threadId,
    model: "runtime-smoke-model",
    cwd: process.cwd(),
  });
  await convex.mutation(api.chat.ensureSession, {
    actor,
    sessionId,
    threadId,
  });

  const queued = await convex.mutation(api.chat.enqueueTurnDispatch, {
    actor,
    threadId,
    dispatchId: randomUUID(),
    turnId,
    idempotencyKey: randomUUID(),
    input: [{ type: "text", text: "smoke turn" }],
  });
  assert.equal(queued.status, "queued");
  const claimed = await convex.mutation(api.chat.claimNextTurnDispatch, {
    actor,
    threadId,
    claimOwner: actor.deviceId,
  });
  assert.ok(claimed, "Expected queued dispatch to be claimed");
  await convex.mutation(api.chat.markTurnDispatchStarted, {
    actor,
    threadId,
    dispatchId: claimed.dispatchId,
    claimToken: claimed.claimToken,
    runtimeThreadId,
    runtimeTurnId,
  });
  await convex.mutation(api.chat.markTurnDispatchCompleted, {
    actor,
    threadId,
    dispatchId: claimed.dispatchId,
    claimToken: claimed.claimToken,
  });

  const observability = await convex.query(api.chat.getDispatchObservability, {
    actor,
    threadId,
    dispatchId: claimed.dispatchId,
  });
  assert.equal(observability.dispatch?.status, "completed");
  assert.equal(observability.claim.owner, actor.deviceId);
  assert.equal(observability.correlations.runtimeTurnId, runtimeTurnId);
  assert.equal(observability.correlations.runtimeThreadId, runtimeThreadId);

  const pushed = await convex.mutation(api.chat.ingestBatch, {
    actor,
    sessionId,
    threadId,
    deltas: [
      {
        eventId: `runtime-smoke-started-${suffix}`,
        turnId,
        streamId,
        kind: "turn/started",
        payloadJson: JSON.stringify({
          method: "turn/started",
          params: { turn: { id: turnId } },
        }),
        cursorStart: 0,
        cursorEnd: 1,
        createdAt: now,
      },
      {
        eventId: `runtime-smoke-completed-${suffix}`,
        turnId,
        streamId,
        kind: "turn/completed",
        payloadJson: JSON.stringify({
          method: "turn/completed",
          params: { turn: { id: turnId, status: "completed" } },
        }),
        cursorStart: 1,
        cursorEnd: 2,
        createdAt: now + 1,
      },
    ],
  });
  const acked = pushed.ackedStreams.find(
    (entry: { streamId: string; ackCursorEnd: number }) => entry.streamId === streamId,
  );
  assert.equal(acked?.ackCursorEnd, 2, "Expected stream checkpoint to advance to 2");

  const stats = await convex.query(api.chat.persistenceStats, {
    actor,
    threadId,
  });
  assert.equal(stats.streamCount, 1, "Expected exactly one stream stat row");
  assert.equal(stats.deltaCount, 2, "Expected exactly two persisted lifecycle deltas");
  assert.deepEqual(stats.latestCursorByStream, [{ streamId, cursor: 2 }]);

  const snapshot = await convex.query(api.chat.threadSnapshot, {
    actor,
    threadId,
  });
  type SnapshotStreamStat = {
    streamId: string;
    state: "streaming" | "finished" | "aborted";
    latestCursor: number;
    deltaCount: number;
  };
  const matching = Array.isArray(snapshot?.streamStats)
    ? snapshot.streamStats.find(
        (entry: SnapshotStreamStat) => entry?.streamId === streamId,
      )
    : null;

  assert.ok(matching, `Expected streamStats entry for ${streamId}`);
  assert.equal(matching.state, "finished");
  assert.equal(matching.latestCursor, 2);
  assert.equal(matching.deltaCount, 2);

  const hygiene = await convex.query(api.chat.dataHygiene, {
    actor,
    threadId,
  });
  assert.equal(hygiene.streamStatOrphans, 0, "Expected no stream stat orphans");
}

main()
  .then(() => {
    console.log("runtime smoke passed");
  })
  .catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`runtime smoke failed: ${reason}`);
    process.exit(1);
  });
