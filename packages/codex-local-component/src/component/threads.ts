import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { mutation, query } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { now, requireThreadForActor, requireThreadRefForActor } from "./utils.js";
import { STREAM_DRAIN_COMPLETE_KIND } from "../shared/streamLifecycle.js";
import { identifyStaleStreamingStatIds } from "./streamStats.js";
import { loadThreadSnapshotRows } from "./repositories/threadSnapshotRepo.js";
import {
  generateUuidV4,
  clampDeleteDelayMs,
  parseDeletedCountsToArray,
} from "./deletionUtils.js";
import { vThreadState, vDeletionJobStatus } from "./threadValidators.js";
import { touchThread, getDeletionJobForActor } from "./threadHelpers.js";

const vThreadHandle = v.object({
  threadId: v.string(),
});

const vResumeResult = v.object({
  threadId: v.string(),
  status: v.literal("active"),
});

const vThreadListResult = v.object({
  page: v.array(
    v.object({
      threadId: v.string(),
      status: v.union(v.literal("active"), v.literal("archived"), v.literal("failed")),
      updatedAt: v.number(),
    }),
  ),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

export const create = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    personality: v.optional(v.string()),
    localThreadId: v.optional(v.string()),
  },
  returns: vThreadHandle,
  handler: async (ctx, args) => {
    const touched = await touchThread(ctx, args);
    return { threadId: touched.threadId };
  },
});

export const resolve = mutation({
  args: {
    actor: vActorContext,
    externalThreadId: v.optional(v.string()),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    personality: v.optional(v.string()),
    localThreadId: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    externalThreadId: v.optional(v.string()),
    created: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ts = now();
    const externalThreadId = args.externalThreadId;

    if (externalThreadId !== undefined) {
      const binding = await ctx.db
        .query("codex_thread_bindings")
        .withIndex("userScope_userId_externalThreadId", (q) =>
          q
            .eq("userScope", userScopeFromActor(args.actor))
            .eq("userId", args.actor.userId)
            .eq("externalThreadId", externalThreadId),
        )
        .first();

      if (binding) {
        const touched = await touchThread(ctx, {
          actor: args.actor,
          threadId: String(binding.threadId),
          ...(args.model !== undefined ? { model: args.model } : {}),
          ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
          ...(args.personality !== undefined ? { personality: args.personality } : {}),
          ...(args.localThreadId !== undefined ? { localThreadId: args.localThreadId } : {}),
        });

        await ctx.db.patch(binding._id, {
          threadRef: touched.threadRef,
          updatedAt: ts,
        });

        return {
          threadId: touched.threadId,
          externalThreadId,
          created: false,
        };
      }
    }

    const newThreadId = generateUuidV4();
    const touched = await touchThread(ctx, {
      actor: args.actor,
      threadId: newThreadId,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
      ...(args.personality !== undefined ? { personality: args.personality } : {}),
      ...(args.localThreadId !== undefined ? { localThreadId: args.localThreadId } : {}),
    });

    if (externalThreadId !== undefined) {
      await ctx.db.insert("codex_thread_bindings", {
        userScope: userScopeFromActor(args.actor),
        ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
        externalThreadId,
        threadId: touched.threadId,
        threadRef: touched.threadRef,
        createdAt: ts,
        updatedAt: ts,
      });
    }

    return {
      threadId: touched.threadId,
      ...(externalThreadId !== undefined ? { externalThreadId } : {}),
      created: true,
    };
  },
});

export const resolveByExternalId = query({
  args: {
    actor: vActorContext,
    externalThreadId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      threadId: v.string(),
      externalThreadId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_externalThreadId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("userId", args.actor.userId)
          .eq("externalThreadId", args.externalThreadId),
      )
      .first();

    if (!binding) {
      return null;
    }

    return {
      threadId: String(binding.threadId),
      externalThreadId: String(binding.externalThreadId),
    };
  },
});

export const getExternalMapping = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: v.union(
    v.null(),
    v.object({
      threadId: v.string(),
      externalThreadId: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const binding = await ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_threadId", (q) =>
        q
          .eq("userScope", userScopeFromActor(args.actor))
          .eq("userId", args.actor.userId)
          .eq("threadId", args.threadId),
      )
      .first();

    if (!binding) {
      return null;
    }

    return {
      threadId: String(binding.threadId),
      externalThreadId: String(binding.externalThreadId),
    };
  },
});

export const resume = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: vResumeResult,
  handler: async (ctx, args) => {
    const thread = await requireThreadForActor(ctx, args.actor, args.threadId);
    return { threadId: String(thread.threadId), status: "active" as const };
  },
});

export const deleteCascade = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deletionJobId: v.string() }),
  handler: async (ctx, args) => {
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);

    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "thread",
      threadId: args.threadId,
      threadRef,
      status: "queued",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );

    return { deletionJobId };
  },
});

export const scheduleDeleteCascade = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    const delayMs = clampDeleteDelayMs(args.delayMs);
    const scheduledFor = ts + delayMs;
    const scheduledFnId = await ctx.scheduler.runAfter(
      delayMs,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );

    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "thread",
      threadId: args.threadId,
      threadRef,
      status: "scheduled",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      scheduledFor,
      scheduledFnId,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    return { deletionJobId, scheduledFor };
  },
});

export const purgeActorData = mutation({
  args: {
    actor: vActorContext,
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deletionJobId: v.string() }),
  handler: async (ctx, args) => {
    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "actor",
      status: "queued",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );

    return { deletionJobId };
  },
});

export const schedulePurgeActorData = mutation({
  args: {
    actor: vActorContext,
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);
    const delayMs = clampDeleteDelayMs(args.delayMs);
    const scheduledFor = ts + delayMs;
    const scheduledFnId = await ctx.scheduler.runAfter(
      delayMs,
      internal.sessions.runDeletionJobChunk,
      {
        userScope,
        deletionJobId,
        ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      },
    );
    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "actor",
      status: "scheduled",
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      scheduledFor,
      scheduledFnId,
      ...(args.reason !== undefined ? { reason: args.reason } : {}),
      deletedCountsJson: JSON.stringify({}),
      createdAt: ts,
      updatedAt: ts,
    });

    return { deletionJobId, scheduledFor };
  },
});

export const cancelScheduledDeletion = mutation({
  args: {
    actor: vActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    cancelled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const job = await getDeletionJobForActor({
      ctx,
      actor: args.actor,
      deletionJobId: args.deletionJobId,
    });
    if (!job) {
      return { deletionJobId: args.deletionJobId, cancelled: false };
    }
    if (job.status !== "scheduled") {
      return { deletionJobId: args.deletionJobId, cancelled: false };
    }
    if (job.scheduledFnId !== undefined) {
      await ctx.scheduler.cancel(job.scheduledFnId);
    }
    const ts = now();
    await ctx.db.patch(job._id, {
      status: "cancelled",
      scheduledFnId: undefined,
      scheduledFor: undefined,
      cancelledAt: ts,
      updatedAt: ts,
      completedAt: ts,
    });
    return { deletionJobId: args.deletionJobId, cancelled: true };
  },
});

export const forceRunScheduledDeletion = mutation({
  args: {
    actor: vActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    forced: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const job = await getDeletionJobForActor({
      ctx,
      actor: args.actor,
      deletionJobId: args.deletionJobId,
    });
    if (!job) {
      return { deletionJobId: args.deletionJobId, forced: false };
    }
    if (job.status !== "scheduled") {
      return { deletionJobId: args.deletionJobId, forced: false };
    }
    if (job.scheduledFnId !== undefined) {
      await ctx.scheduler.cancel(job.scheduledFnId);
    }
    const ts = now();
    await ctx.db.patch(job._id, {
      status: "queued",
      scheduledFnId: undefined,
      scheduledFor: undefined,
      updatedAt: ts,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.sessions.runDeletionJobChunk,
      {
        userScope: String(job.userScope),
        deletionJobId: String(job.deletionJobId),
        ...(job.batchSize !== undefined ? { batchSize: Number(job.batchSize) } : {}),
      },
    );
    return { deletionJobId: args.deletionJobId, forced: true };
  },
});

export const getDeletionJobStatus = query({
  args: {
    actor: vActorContext,
    deletionJobId: v.string(),
  },
  returns: v.union(v.null(), vDeletionJobStatus),
  handler: async (ctx, args) => {
    const job = await getDeletionJobForActor({
      ctx,
      actor: args.actor,
      deletionJobId: args.deletionJobId,
    });
    if (!job) {
      return null;
    }

    return {
      deletionJobId: String(job.deletionJobId),
      status: job.status,
      targetKind: job.targetKind,
      ...(job.threadId !== undefined ? { threadId: String(job.threadId) } : {}),
      ...(job.turnId !== undefined ? { turnId: String(job.turnId) } : {}),
      ...(job.batchSize !== undefined ? { batchSize: Number(job.batchSize) } : {}),
      ...(job.scheduledFor !== undefined ? { scheduledFor: Number(job.scheduledFor) } : {}),
      ...(job.reason !== undefined ? { reason: String(job.reason) } : {}),
      ...(job.phase !== undefined ? { phase: String(job.phase) } : {}),
      deletedCountsByTable: parseDeletedCountsToArray(String(job.deletedCountsJson)),
      ...(job.errorCode !== undefined ? { errorCode: String(job.errorCode) } : {}),
      ...(job.errorMessage !== undefined ? { errorMessage: String(job.errorMessage) } : {}),
      createdAt: Number(job.createdAt),
      ...(job.startedAt !== undefined ? { startedAt: Number(job.startedAt) } : {}),
      ...(job.completedAt !== undefined ? { completedAt: Number(job.completedAt) } : {}),
      ...(job.cancelledAt !== undefined ? { cancelledAt: Number(job.cancelledAt) } : {}),
      updatedAt: Number(job.updatedAt),
    };
  },
});

export const list = query({
  args: {
    actor: vActorContext,
    paginationOpts: paginationOptsValidator,
  },
  returns: vThreadListResult,
  handler: async (ctx, args) => {
    const cursor = decodeKeysetCursor<{ updatedAt: number; threadId: string }>(
      args.paginationOpts.cursor,
    );

    const scanned = await ctx.db
      .query("codex_threads")
      .withIndex("userScope_userId_updatedAt_threadId", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("userId", args.actor.userId),
      )
      .filter((q) =>
        cursor
          ? q.or(
              q.lt(q.field("updatedAt"), cursor.updatedAt),
              q.and(
                q.eq(q.field("updatedAt"), cursor.updatedAt),
                q.lt(q.field("threadId"), cursor.threadId),
              ),
            )
          : q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
      )
      .order("desc")
      .take(args.paginationOpts.numItems + 1);

    const result = keysetPageResult(scanned, args.paginationOpts, (thread) => ({
      updatedAt: Number(thread.updatedAt),
      threadId: String(thread.threadId),
    }));

    return {
      ...result,
      page: result.page.map((thread) => ({
        threadId: String(thread.threadId),
        status: thread.status,
        updatedAt: Number(thread.updatedAt),
      })),
    };
  },
});

export const getState = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: vThreadState,
  handler: async (ctx, args) => {
    const thread = await requireThreadForActor(ctx, args.actor, args.threadId);
    const {
      turns,
      streams,
      stats,
      approvals,
      recentMessages,
      lifecycle,
    } = await loadThreadSnapshotRows({
      ctx,
      actor: args.actor,
      threadId: args.threadId,
    });

    const allStreams = streams.map((stream) => ({
      streamId: String(stream.streamId),
      turnId: String(stream.turnId),
      state: String(stream.state.kind),
      startedAt: Number(stream.startedAt),
    }));
    const activeStreamIds = new Set(
      allStreams.filter((stream) => stream.state === "streaming").map((stream) => stream.streamId),
    );
    const finalizedStaleStreamIds = identifyStaleStreamingStatIds({
      activeStreamIds,
      stats: stats.map((stat) => ({
        streamId: String(stat.streamId),
        state: stat.state,
      })),
    });

    const lifecycleMarkers = lifecycle
      .filter((event) => event.kind === STREAM_DRAIN_COMPLETE_KIND)
      .map((event) => {
        let streamId: string | undefined;
        try {
          const parsed = JSON.parse(event.payloadJson) as { streamId?: unknown };
          if (typeof parsed.streamId === "string") {
            streamId = parsed.streamId;
          }
        } catch (error) {
          console.warn("[threads] Failed to parse lifecycle event payloadJson:", error);
          streamId = undefined;
        }
        return {
          kind: String(event.kind),
          ...(event.turnId !== undefined ? { turnId: String(event.turnId) } : {}),
          ...(streamId !== undefined ? { streamId } : {}),
          createdAt: Number(event.createdAt),
        };
      });

    return {
      threadId: String(thread.threadId),
      threadStatus: String(thread.status),
      turns: turns.map((turn) => ({
        turnId: String(turn.turnId),
        status: String(turn.status),
        startedAt: Number(turn.startedAt),
        ...(turn.completedAt !== undefined ? { completedAt: Number(turn.completedAt) } : {}),
      })),
      activeStreams: allStreams.filter((stream) => stream.state === "streaming"),
      allStreams,
      streamStats: stats.map((stat) => ({
        streamId: String(stat.streamId),
        state: finalizedStaleStreamIds.has(String(stat.streamId)) ? "finished" : stat.state,
        deltaCount: Number(stat.deltaCount),
        latestCursor: Number(stat.latestCursor),
      })),
      pendingApprovals: approvals.map((approval) => ({
        turnId: String(approval.turnId),
        itemId: String(approval.itemId),
        kind: String(approval.kind),
        ...(approval.reason ? { reason: String(approval.reason) } : {}),
      })),
      recentMessages: recentMessages.map((message) => ({
        messageId: String(message.messageId),
        turnId: String(message.turnId),
        role: message.role,
        status: message.status,
        text: String(message.text),
        createdAt: Number(message.createdAt),
        updatedAt: Number(message.updatedAt),
        ...(message.completedAt !== undefined ? { completedAt: Number(message.completedAt) } : {}),
      })),
      lifecycleMarkers,
    };
  },
});
