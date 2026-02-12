import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
import { deleteStreamStat, setStreamStatState } from "./streamStats.js";
import { now } from "./utils.js";
import { STREAM_DRAIN_COMPLETE_KIND } from "../shared/streamLifecycle.js";

const STREAM_CLEANUP_BATCH_SIZE_DEFAULT = 500;
const STREAM_CLEANUP_BATCH_SIZE_MAX = 2000;
const DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS = 300_000;

async function emitStreamDrainCompleteMarker(
  ctx: MutationCtx,
  args: {
    userScope: string;
    threadId: string;
    turnId: string;
    streamId: string;
    createdAt: number;
  },
): Promise<void> {
  const eventId = `${STREAM_DRAIN_COMPLETE_KIND}:${args.streamId}`;
  const existing = await ctx.db
    .query("codex_lifecycle_events")
    .withIndex("userScope_threadId_eventId", (q) =>
      q
        .eq("userScope", args.userScope)
        .eq("threadId", args.threadId)
        .eq("eventId", eventId),
    )
    .first();
  if (existing) {
    return;
  }

  await ctx.db.insert("codex_lifecycle_events", {
    userScope: args.userScope,
    threadId: args.threadId,
    turnId: args.turnId,
    eventId,
    kind: STREAM_DRAIN_COMPLETE_KIND,
    payloadJson: JSON.stringify({ streamId: args.streamId }),
    createdAt: args.createdAt,
  });
}

export const timeoutStream = internalMutation({
  args: {
    userScope: v.string(),
    streamId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stream = await ctx.db
      .query("codex_streams")
      .withIndex("userScope_streamId")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), args.userScope),
          q.eq(q.field("streamId"), args.streamId),
        ),
      )
      .first();

    if (!stream || stream.state.kind !== "streaming") {
      return null;
    }

    const endedAt = now();
    const cleanupFnId = await ctx.scheduler.runAfter(
      DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS,
      makeFunctionReference<"mutation">("streams:cleanupFinishedStream"),
      {
        userScope: args.userScope,
        streamId: args.streamId,
        batchSize: STREAM_CLEANUP_BATCH_SIZE_DEFAULT,
      },
    );

    await ctx.db.patch(stream._id, {
      state: {
        kind: "aborted",
        reason: args.reason ?? "stream timeout",
        endedAt,
      },
      endedAt,
      cleanupScheduledAt: endedAt,
      cleanupFnId,
    });

    await setStreamStatState(ctx, {
      userScope: args.userScope,
      threadId: stream.threadId,
      turnId: stream.turnId,
      streamId: args.streamId,
      state: "aborted",
    });

    return null;
  },
});

export const cleanupFinishedStream = internalMutation({
  args: {
    userScope: v.string(),
    streamId: v.string(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deletedDeltas: v.number(), streamDeleted: v.boolean(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    const batchSize = Math.max(
      1,
      Math.min(args.batchSize ?? STREAM_CLEANUP_BATCH_SIZE_DEFAULT, STREAM_CLEANUP_BATCH_SIZE_MAX),
    );

    const stream = await ctx.db
      .query("codex_streams")
      .withIndex("userScope_streamId", (q) =>
        q.eq("userScope", args.userScope).eq("streamId", args.streamId),
      )
      .first();

    if (!stream) {
      await deleteStreamStat(ctx, args.userScope, args.streamId);
      return { deletedDeltas: 0, streamDeleted: false, hasMore: false };
    }

    const batch = await ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("userScope_streamId_cursorStart", (q) =>
        q.eq("userScope", args.userScope).eq("streamId", args.streamId),
      )
      .take(batchSize);

    await Promise.all(batch.map((delta) => ctx.db.delete(delta._id)));

    const hasMore = batch.length >= batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"mutation">("streams:cleanupFinishedStream"),
        {
          userScope: args.userScope,
          streamId: args.streamId,
          batchSize,
        },
      );
      return { deletedDeltas: batch.length, streamDeleted: false, hasMore: true };
    }

    const remaining = await ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("userScope_streamId_cursorStart", (q) =>
        q.eq("userScope", args.userScope).eq("streamId", args.streamId),
      )
      .take(1);

    if (remaining.length > 0) {
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"mutation">("streams:cleanupFinishedStream"),
        {
          userScope: args.userScope,
          streamId: args.streamId,
          batchSize,
        },
      );
      return { deletedDeltas: batch.length, streamDeleted: false, hasMore: true };
    }

    const currentStream = await ctx.db
      .query("codex_streams")
      .withIndex("userScope_streamId", (q) =>
        q.eq("userScope", args.userScope).eq("streamId", args.streamId),
      )
      .first();

    if (!currentStream) {
      await deleteStreamStat(ctx, args.userScope, args.streamId);
      return { deletedDeltas: batch.length, streamDeleted: false, hasMore: false };
    }

    if (currentStream.state.kind === "streaming") {
      return { deletedDeltas: batch.length, streamDeleted: false, hasMore: false };
    }

    const markerCreatedAt = now();
    await emitStreamDrainCompleteMarker(ctx, {
      userScope: args.userScope,
      threadId: String(currentStream.threadId),
      turnId: String(currentStream.turnId),
      streamId: String(currentStream.streamId),
      createdAt: markerCreatedAt,
    });

    await ctx.db.delete(currentStream._id);
    await deleteStreamStat(ctx, args.userScope, args.streamId);
    return { deletedDeltas: batch.length, streamDeleted: true, hasMore: false };
  },
});

export const cleanupExpiredDeltas = internalMutation({
  args: {
    nowMs: v.number(),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    const batchSize = Math.max(1, Math.min(args.batchSize ?? 1000, 5000));
    const expired = await ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("expiresAt")
      .filter((q) => q.lte(q.field("expiresAt"), args.nowMs))
      .take(batchSize);

    await Promise.all(expired.map((doc) => ctx.db.delete(doc._id)));

    const hasMore = expired.length >= batchSize;
    if (hasMore) {
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"mutation">("streams:cleanupExpiredDeltas"),
        {
          nowMs: args.nowMs,
          batchSize,
        },
      );
    }

    return { deleted: expired.length, hasMore };
  },
});

export const auditDataHygiene = internalQuery({
  args: {
    userScope: v.string(),
    sampleSize: v.optional(v.number()),
  },
  returns: v.object({
    scannedStreamStats: v.number(),
    streamStatOrphans: v.number(),
    orphanStreamIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const sampleSize = Math.max(1, Math.min(args.sampleSize ?? 1000, 5000));
    const stats = await ctx.db
      .query("codex_stream_stats")
      .withIndex("userScope_streamId", (q) => q.eq("userScope", args.userScope))
      .take(sampleSize);

    let streamStatOrphans = 0;
    const orphanStreamIds: string[] = [];

    for (const stat of stats) {
      const stream = await ctx.db
        .query("codex_streams")
        .withIndex("userScope_streamId", (q) =>
          q.eq("userScope", args.userScope).eq("streamId", stat.streamId),
        )
        .first();

      if (!stream) {
        streamStatOrphans += 1;
        if (orphanStreamIds.length < 25) {
          orphanStreamIds.push(String(stat.streamId));
        }
      }
    }

    return {
      scannedStreamStats: stats.length,
      streamStatOrphans,
      orphanStreamIds,
    };
  },
});
