import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { resolveConvexUrl } from "./smoke-env.js";

type UnknownRecord = Record<string, unknown>;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number";
}

function hasRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

async function main(): Promise<void> {
  const convexUrl = resolveConvexUrl();
  assert.ok(convexUrl, "Missing Convex URL. Run `pnpm run dev:convex:once` first.");

  const convex = new ConvexHttpClient(convexUrl);
  const suffix = randomUUID();
  const actor = {
    tenantId: "contract-smoke-tenant",
    userId: "contract-smoke-user",
    deviceId: `contract-smoke-device-${suffix}`,
  };
  const threadId = `contract-smoke-thread-${suffix}`;
  const turnId = `contract-smoke-turn-${suffix}`;
  const streamId = `contract-smoke-stream-${suffix}`;
  const sessionId = randomUUID();

  const thread = await convex.mutation(api.chat.ensureThread, {
    actor,
    threadId,
  });
  assert.ok(hasRecord(thread));
  assert.equal(thread.threadId, threadId);

  const heartbeat = await convex.mutation(api.chat.ensureSession, {
    actor,
    sessionId,
    threadId,
  });
  assert.ok(hasRecord(heartbeat));
  assert.equal(heartbeat.sessionId, sessionId);
  assert.equal(heartbeat.threadId, threadId);
  assert.ok(
    heartbeat.status === "created" || heartbeat.status === "active",
    "Expected ensureSession status to be created|active",
  );

  const pushed = await convex.mutation(api.chat.ingestEvent, {
    actor,
    sessionId,
    threadId,
    event: {
      eventId: `contract-smoke-event-${suffix}`,
      turnId,
      streamId,
      kind: "turn/started",
      payloadJson: JSON.stringify({
        method: "turn/started",
        params: { turn: { id: turnId } },
      }),
      cursorStart: 0,
      cursorEnd: 1,
      createdAt: Date.now(),
    },
  });
  assert.ok(hasRecord(pushed));
  const acked = Array.isArray(pushed.ackedStreams)
    ? pushed.ackedStreams.find((entry) => hasRecord(entry) && entry.streamId === streamId)
    : undefined;
  assert.ok(acked);
  assert.equal(acked.ackCursorEnd, 1);

  const snapshot = await convex.query(api.chat.threadSnapshot, {
    actor,
    threadId,
  });
  assert.ok(hasRecord(snapshot));
  assert.ok(isString(snapshot.threadId));
  assert.ok(Array.isArray(snapshot.turns));
  assert.ok(Array.isArray(snapshot.streamStats));

  const stateStream = snapshot.streamStats.find(
    (entry) => hasRecord(entry) && entry.streamId === streamId,
  );
  assert.ok(stateStream, "Expected streamStats to include wrapper-ingested stream");
  assert.ok(isString(stateStream.state));
  assert.ok(isNumber(stateStream.latestCursor));
  assert.ok(isNumber(stateStream.deltaCount));

  const stats = await convex.query(api.chat.persistenceStats, {
    actor,
    threadId,
  });
  assert.ok(hasRecord(stats));
  assert.ok(isNumber(stats.streamCount));
  assert.ok(isNumber(stats.deltaCount));
  assert.ok(Array.isArray(stats.latestCursorByStream));

  const hygiene = await convex.query(api.chat.dataHygiene, {
    actor,
    threadId,
  });
  assert.ok(hasRecord(hygiene));
  assert.ok(isNumber(hygiene.scannedStreamStats));
  assert.ok(isNumber(hygiene.streamStatOrphans));
  assert.ok(Array.isArray(hygiene.orphanStreamIds));
  assert.equal(hygiene.streamStatOrphans, 0);
}

main()
  .then(() => {
    console.log("wrapper contract smoke passed");
  })
  .catch((error) => {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`wrapper contract smoke failed: ${reason}`);
    process.exit(1);
  });
