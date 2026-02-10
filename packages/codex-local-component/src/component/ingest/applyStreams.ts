import { makeFunctionReference } from "convex/server";
import {
  DELTA_EVENT_KINDS,
  DELTA_TTL_MS,
  DEFAULT_STREAM_DELETE_BATCH_SIZE,
  LIFECYCLE_EVENT_KINDS,
  syncError,
} from "../syncRuntime.js";
import { addStreamDeltaStats, ensureStreamStat, setStreamStatState } from "../streamStats.js";
import { now } from "../utils.js";
import type { IngestContext, NormalizedInboundEvent } from "./types.js";
import type { IngestStateCache } from "./stateCache.js";

export async function persistLifecycleEventIfMissing(
  ingest: IngestContext,
  event: NormalizedInboundEvent,
): Promise<void> {
  if (event.type !== "lifecycle_event") {
    return;
  }

  const existingLifecycle = await ingest.ctx.db
    .query("codex_lifecycle_events")
    .withIndex("tenantId_threadId_eventId", (q) =>
      q
        .eq("tenantId", ingest.args.actor.tenantId)
        .eq("threadId", ingest.args.threadId)
        .eq("eventId", event.eventId),
    )
    .first();

  if (existingLifecycle) {
    return;
  }

  await ingest.ctx.db.insert("codex_lifecycle_events", {
    tenantId: ingest.args.actor.tenantId,
    threadId: ingest.args.threadId,
    eventId: event.eventId,
    kind: event.kind,
    payloadJson: event.payloadJson,
    createdAt: event.createdAt,
    ...(event.turnId ? { turnId: event.turnId } : {}),
  });
}

export async function applyStreamEvent(
  ingest: IngestContext,
  event: NormalizedInboundEvent,
  cache: IngestStateCache,
): Promise<void> {
  if (event.type !== "stream_delta") {
    return;
  }

  let stream = await cache.getStreamRecord(event.streamId);
  if (!stream) {
    const streamId = await ingest.ctx.db.insert("codex_streams", {
      tenantId: ingest.args.actor.tenantId,
      threadId: ingest.args.threadId,
      turnId: event.turnId,
      streamId: event.streamId,
      state: { kind: "streaming", lastHeartbeatAt: now() },
      startedAt: now(),
    });
    stream = {
      _id: streamId,
      state: { kind: "streaming" },
      turnId: event.turnId,
    };
    cache.setStreamRecord(event.streamId, stream);
    await ensureStreamStat(ingest.ctx, {
      tenantId: ingest.args.actor.tenantId,
      threadId: ingest.args.threadId,
      turnId: event.turnId,
      streamId: event.streamId,
      state: "streaming",
    });
  }

  if (event.cursorStart >= event.cursorEnd) {
    syncError(
      "E_SYNC_INVALID_CURSOR_RANGE",
      `Invalid cursor range start=${event.cursorStart} end=${event.cursorEnd} for eventId=${event.eventId}`,
    );
  }

  const streamExpectedCursor = ingest.streamState.expectedCursorByStreamId.get(event.streamId) ?? 0;
  const existingStreamEvent = await ingest.ctx.db
    .query("codex_stream_deltas_ttl")
    .withIndex("tenantId_streamId_eventId", (q) =>
      q
        .eq("tenantId", ingest.args.actor.tenantId)
        .eq("streamId", event.streamId)
        .eq("eventId", event.eventId),
    )
    .first();

  if (existingStreamEvent) {
    ingest.streamState.expectedCursorByStreamId.set(
      event.streamId,
      Math.max(streamExpectedCursor, Number(existingStreamEvent.cursorEnd)),
    );
    ingest.streamState.streamCheckpointCursorByStreamId.set(
      event.streamId,
      Math.max(
        ingest.streamState.streamCheckpointCursorByStreamId.get(event.streamId) ?? 0,
        Number(existingStreamEvent.cursorEnd),
      ),
    );
    return;
  }

  if (event.cursorStart < streamExpectedCursor) {
    syncError(
      "E_SYNC_OUT_OF_ORDER",
      `Expected cursorStart>=${streamExpectedCursor} for streamId=${event.streamId} but got ${event.cursorStart} for eventId=${event.eventId}`,
    );
  }
  if (event.cursorStart > streamExpectedCursor) {
    ingest.ingestStatus = "partial";
  }

  if (ingest.collected.inBatchEventIds.has(event.eventId)) {
    syncError("E_SYNC_DUP_EVENT_IN_BATCH", `Duplicate eventId in request batch: ${event.eventId}`);
  }
  ingest.collected.inBatchEventIds.add(event.eventId);

  const shouldPersist =
    LIFECYCLE_EVENT_KINDS.has(event.kind) ||
    (ingest.runtime.saveStreamDeltas && DELTA_EVENT_KINDS.has(event.kind));

  if (shouldPersist) {
    await ingest.ctx.db.insert("codex_stream_deltas_ttl", {
      tenantId: ingest.args.actor.tenantId,
      streamId: event.streamId,
      turnId: event.turnId,
      eventId: event.eventId,
      cursorStart: event.cursorStart,
      cursorEnd: event.cursorEnd,
      kind: event.kind,
      payloadJson: event.payloadJson,
      createdAt: event.createdAt,
      expiresAt: now() + DELTA_TTL_MS,
    });

    const existing = ingest.streamState.persistedStatsByStreamId.get(event.streamId);
    if (existing) {
      existing.deltaCount += 1;
      existing.latestCursor = Math.max(existing.latestCursor, event.cursorEnd);
    } else {
      ingest.streamState.persistedStatsByStreamId.set(event.streamId, {
        threadId: ingest.args.threadId,
        turnId: event.turnId,
        latestCursor: event.cursorEnd,
        deltaCount: 1,
      });
    }

    ingest.lastPersistedCursor = event.cursorEnd;
    ingest.persistedAnyEvent = true;
  }

  ingest.streamState.streamCheckpointCursorByStreamId.set(
    event.streamId,
    Math.max(ingest.streamState.streamCheckpointCursorByStreamId.get(event.streamId) ?? 0, event.cursorEnd),
  );
  ingest.streamState.expectedCursorByStreamId.set(event.streamId, event.cursorEnd);
}

export async function finalizeStreamStates(
  ingest: IngestContext,
  cache: IngestStateCache,
): Promise<void> {
  for (const [streamId, terminal] of ingest.collected.terminalByStream) {
    const stream = await cache.getStreamRecord(streamId);
    if (!stream || stream.state.kind !== "streaming") {
      continue;
    }

    const endedAt = now();
    const cleanupFnId = await ingest.ctx.scheduler.runAfter(
      ingest.runtime.finishedStreamDeleteDelayMs,
      makeFunctionReference<"mutation">("streams:cleanupFinishedStream"),
      {
        tenantId: ingest.args.actor.tenantId,
        streamId,
        batchSize: DEFAULT_STREAM_DELETE_BATCH_SIZE,
      },
    );

    if (terminal.status === "completed") {
      await ingest.ctx.db.patch(stream._id, {
        state: { kind: "finished", endedAt },
        endedAt,
        cleanupScheduledAt: endedAt,
        cleanupFnId,
      });
      await setStreamStatState(ingest.ctx, {
        tenantId: ingest.args.actor.tenantId,
        threadId: ingest.args.threadId,
        turnId: stream.turnId,
        streamId,
        state: "finished",
      });
      cache.setStreamRecord(streamId, {
        ...stream,
        state: { kind: "finished" },
      });
    } else {
      await ingest.ctx.db.patch(stream._id, {
        state: {
          kind: "aborted",
          reason: terminal.error ?? terminal.status,
          endedAt,
        },
        endedAt,
        cleanupScheduledAt: endedAt,
        cleanupFnId,
      });
      await setStreamStatState(ingest.ctx, {
        tenantId: ingest.args.actor.tenantId,
        threadId: ingest.args.threadId,
        turnId: stream.turnId,
        streamId,
        state: "aborted",
      });
      cache.setStreamRecord(streamId, {
        ...stream,
        state: { kind: "aborted" },
      });
    }
  }
}

export async function flushStreamStats(ingest: IngestContext): Promise<void> {
  for (const [streamId, stats] of ingest.streamState.persistedStatsByStreamId) {
    await addStreamDeltaStats(ingest.ctx, {
      tenantId: ingest.args.actor.tenantId,
      threadId: stats.threadId,
      turnId: stats.turnId,
      streamId,
      deltaCount: stats.deltaCount,
      latestCursor: stats.latestCursor,
    });
  }
}
