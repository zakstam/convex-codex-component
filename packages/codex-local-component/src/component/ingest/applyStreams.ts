import {
  DELTA_TTL_MS,
  LIFECYCLE_EVENT_KINDS,
  REASONING_RAW_DELTA_EVENT_KINDS,
  REASONING_SUMMARY_DELTA_EVENT_KINDS,
  STREAM_TEXT_DELTA_EVENT_KINDS,
  syncError,
} from "../syncRuntime.js";
import {
  addStreamDeltaStatsBatch,
  ensureStreamStat,
} from "../streamStats.js";
import { now } from "../utils.js";
import type { NormalizedInboundEvent, StreamIngestContext } from "./types.js";
import { userScopeFromActor } from "../scope.js";
import type { IngestStateCache } from "./stateCache.js";

export async function persistLifecycleEventIfMissing(
  ingest: StreamIngestContext,
  event: NormalizedInboundEvent,
  cache: IngestStateCache,
): Promise<void> {
  if (event.type !== "lifecycle_event") {
    return;
  }

  const existingLifecycle = await ingest.ctx.db
    .query("codex_lifecycle_events")
    .withIndex("userScope_threadId_eventId", (q) =>
      q
        .eq("userScope", userScopeFromActor(ingest.args.actor))
        .eq("threadId", ingest.args.threadId)
        .eq("eventId", event.eventId),
    )
    .first();

  if (existingLifecycle) {
    return;
  }
  const turnForLifecycle = event.turnId ? await cache.getTurnRecord(event.turnId) : null;

  await ingest.ctx.db.insert("codex_lifecycle_events", {
    userScope: userScopeFromActor(ingest.args.actor),
    threadId: ingest.args.threadId,
    threadRef: ingest.thread._id,
    eventId: event.eventId,
    kind: event.kind,
    payloadJson: event.payloadJson,
    createdAt: event.createdAt,
    ...(event.turnId ? { turnId: event.turnId } : {}),
    ...(turnForLifecycle ? { turnRef: turnForLifecycle._id } : {}),
  });
}

export async function applyStreamEvent(
  ingest: StreamIngestContext,
  event: NormalizedInboundEvent,
  cache: IngestStateCache,
): Promise<void> {
  if (event.type !== "stream_delta") {
    return;
  }

  const turn = await cache.getTurnRecord(event.turnId);
  if (!turn) {
    return;
  }
  let stream = await cache.getStreamRecord(turn._id, event.streamId);
  if (!stream) {
    const collidingStream = await ingest.ctx.db
      .query("codex_streams")
      .withIndex("userScope_streamId", (q) =>
        q
          .eq("userScope", userScopeFromActor(ingest.args.actor))
          .eq("streamId", event.streamId),
      )
      .first();
    if (
      collidingStream &&
      (String(collidingStream.threadId) !== ingest.args.threadId ||
        String(collidingStream.turnId) !== event.turnId)
    ) {
      syncError(
        "E_SYNC_STREAM_ID_COLLISION",
        `streamId=${event.streamId} is already bound to threadId=${String(collidingStream.threadId)} turnId=${String(collidingStream.turnId)} and cannot be reused by threadId=${ingest.args.threadId} turnId=${event.turnId}`,
      );
    }
    if (collidingStream) {
      stream = {
        _id: collidingStream._id,
        state: { kind: collidingStream.state.kind },
        turnId: String(collidingStream.turnId),
        turnRef: collidingStream.turnRef,
      };
      cache.setStreamRecord(turn._id, event.streamId, stream);
    }
  }
  if (!stream) {
    const streamId = await ingest.ctx.db.insert("codex_streams", {
      userScope: userScopeFromActor(ingest.args.actor),
      threadId: ingest.args.threadId,
      threadRef: ingest.thread._id,
      turnId: event.turnId,
      turnRef: turn._id,
      streamId: event.streamId,
      state: { kind: "streaming", lastHeartbeatAt: now() },
      startedAt: now(),
    });
    stream = {
      _id: streamId,
      state: { kind: "streaming" },
      turnId: event.turnId,
      turnRef: turn._id,
    };
    cache.setStreamRecord(turn._id, event.streamId, stream);
    await ensureStreamStat(ingest.ctx, {
      userScope: userScopeFromActor(ingest.args.actor),
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
    .withIndex("userScope_streamId_eventId", (q) =>
      q
        .eq("userScope", userScopeFromActor(ingest.args.actor))
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
    ingest.progress.ingestStatus = "partial";
  }

  if (ingest.collected.inBatchEventIds.has(event.eventId)) {
    syncError("E_SYNC_DUP_EVENT_IN_BATCH", `Duplicate eventId in request batch: ${event.eventId}`);
  }
  ingest.collected.inBatchEventIds.add(event.eventId);

  const shouldPersist =
    LIFECYCLE_EVENT_KINDS.has(event.kind) ||
    (ingest.runtime.saveStreamDeltas && STREAM_TEXT_DELTA_EVENT_KINDS.has(event.kind)) ||
    (ingest.runtime.saveReasoningDeltas && REASONING_SUMMARY_DELTA_EVENT_KINDS.has(event.kind)) ||
    (ingest.runtime.saveReasoningDeltas &&
      ingest.runtime.exposeRawReasoningDeltas &&
      REASONING_RAW_DELTA_EVENT_KINDS.has(event.kind));

  if (shouldPersist) {
    await ingest.ctx.db.insert("codex_stream_deltas_ttl", {
      userScope: userScopeFromActor(ingest.args.actor),
      streamId: event.streamId,
      streamRef: stream._id,
      turnId: event.turnId,
      turnRef: stream.turnRef,
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

    ingest.progress.lastPersistedCursor = event.cursorEnd;
    ingest.progress.persistedAnyEvent = true;
  }

  ingest.streamState.streamCheckpointCursorByStreamId.set(
    event.streamId,
    Math.max(ingest.streamState.streamCheckpointCursorByStreamId.get(event.streamId) ?? 0, event.cursorEnd),
  );
  ingest.streamState.expectedCursorByStreamId.set(event.streamId, event.cursorEnd);
}

export async function flushStreamStats(ingest: StreamIngestContext): Promise<void> {
  await addStreamDeltaStatsBatch(ingest.ctx, {
    userScope: userScopeFromActor(ingest.args.actor),
    threadId: ingest.args.threadId,
    updates: Array.from(ingest.streamState.persistedStatsByStreamId.entries()).map(
      ([streamId, stats]) => ({
        streamId,
        turnId: stats.turnId,
        deltaCount: stats.deltaCount,
        latestCursor: stats.latestCursor,
      }),
    ),
  });
}
