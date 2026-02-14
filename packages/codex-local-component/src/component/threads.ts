import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.js";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { authzError, now, requireThreadForActor, requireThreadRefForActor } from "./utils.js";
import { STREAM_DRAIN_COMPLETE_KIND } from "../shared/streamLifecycle.js";
import { identifyStaleStreamingStatIds } from "./streamStats.js";

const DEFAULT_DELETE_GRACE_MS = 10 * 60 * 1000;
const MIN_DELETE_GRACE_MS = 1_000;
const MAX_DELETE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const vThreadState = v.object({
  threadId: v.string(),
  threadStatus: v.string(),
  turns: v.array(
    v.object({
      turnId: v.string(),
      status: v.string(),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  activeStreams: v.array(
    v.object({
      streamId: v.string(),
      turnId: v.string(),
      state: v.string(),
      startedAt: v.number(),
    }),
  ),
  allStreams: v.array(
    v.object({
      streamId: v.string(),
      turnId: v.string(),
      state: v.string(),
      startedAt: v.number(),
    }),
  ),
  streamStats: v.array(
    v.object({
      streamId: v.string(),
      state: v.union(v.literal("streaming"), v.literal("finished"), v.literal("aborted")),
      deltaCount: v.number(),
      latestCursor: v.number(),
    }),
  ),
  pendingApprovals: v.array(
    v.object({
      turnId: v.string(),
      itemId: v.string(),
      kind: v.string(),
      reason: v.optional(v.string()),
    }),
  ),
  recentMessages: v.array(
    v.object({
      messageId: v.string(),
      turnId: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
      status: v.union(v.literal("streaming"), v.literal("completed"), v.literal("failed"), v.literal("interrupted")),
      text: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  lifecycleMarkers: v.array(
    v.object({
      kind: v.string(),
      turnId: v.optional(v.string()),
      streamId: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
});

const vDeletionJobStatus = v.object({
  deletionJobId: v.string(),
  status: v.union(
    v.literal("scheduled"),
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  targetKind: v.union(v.literal("thread"), v.literal("turn"), v.literal("actor")),
  threadId: v.optional(v.string()),
  turnId: v.optional(v.string()),
  batchSize: v.optional(v.number()),
  scheduledFor: v.optional(v.number()),
  reason: v.optional(v.string()),
  phase: v.optional(v.string()),
  deletedCountsByTable: v.array(
    v.object({
      tableName: v.string(),
      deleted: v.number(),
    }),
  ),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
  updatedAt: v.number(),
});

function parseDeletedCounts(
  deletedCountsJson: string,
): Array<{ tableName: string; deleted: number }> {
  try {
    const parsed = JSON.parse(deletedCountsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed)
      .filter(([, deleted]) => typeof deleted === "number" && Number.isFinite(deleted))
      .map(([tableName, deleted]) => ({
        tableName,
        deleted: Number(deleted),
      }))
      .sort((left, right) => left.tableName.localeCompare(right.tableName));
  } catch (error) {
    void error;
    return [];
  }
}

function generateUuidV4(): string {
  if (
    "crypto" in globalThis &&
    typeof globalThis.crypto === "object" &&
    globalThis.crypto !== null &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

function clampDeleteDelayMs(delayMs: number | undefined): number {
  return Math.max(
    MIN_DELETE_GRACE_MS,
    Math.min(delayMs ?? DEFAULT_DELETE_GRACE_MS, MAX_DELETE_GRACE_MS),
  );
}

async function touchThread(
  ctx: MutationCtx,
  args: {
    actor: { userId?: string };
    threadId: string;
    model?: string;
    cwd?: string;
    personality?: string;
    localThreadId?: string;
  },
): Promise<{ threadId: string; created: boolean; threadRef: Id<"codex_threads"> }> {
  const existing = await ctx.db
    .query("codex_threads")
    .withIndex("userScope_threadId")
    .filter((q) =>
      q.and(
        q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
        q.eq(q.field("threadId"), args.threadId),
      ),
    )
    .first();

  const ts = now();
  if (existing) {
    if (existing.userId !== args.actor.userId) {
      authzError(
        "E_AUTH_THREAD_FORBIDDEN",
        `User ${args.actor.userId} is not allowed to access thread ${args.threadId}`,
      );
    }
    await ctx.db.patch(existing._id, {
      status: "active",
      updatedAt: ts,
      model: args.model ?? existing.model,
      cwd: args.cwd ?? existing.cwd,
      personality: args.personality ?? existing.personality,
      localThreadId: args.localThreadId ?? existing.localThreadId,
    });
    return { threadId: String(existing.threadId), created: false, threadRef: existing._id };
  }

  const threadRef = await ctx.db.insert("codex_threads", {
    userScope: userScopeFromActor(args.actor),
    ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
    threadId: args.threadId,
    status: "active",
    ...(args.localThreadId ? { localThreadId: args.localThreadId } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.personality ? { personality: args.personality } : {}),
    createdAt: ts,
    updatedAt: ts,
  });

  return { threadId: args.threadId, created: true, threadRef };
}

export const create = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    personality: v.optional(v.string()),
    localThreadId: v.optional(v.string()),
  },
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
  handler: async (ctx, args) => {
    const thread = await requireThreadForActor(ctx, args.actor, args.threadId);
    return { threadId: String(thread.threadId), status: "active" };
  },
});

async function getDeletionJobForActor(args: {
  ctx: MutationCtx | QueryCtx;
  actor: { userId?: string };
  deletionJobId: string;
}) {
  const job = await args.ctx.db
    .query("codex_deletion_jobs")
    .withIndex("userScope_deletionJobId", (q) =>
      q.eq("userScope", userScopeFromActor(args.actor)).eq("deletionJobId", args.deletionJobId),
    )
    .first();
  if (!job) {
    return null;
  }
  if (job.userId !== args.actor.userId) {
    return null;
  }
  return job;
}

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
      makeFunctionReference<"mutation">("deletionInternal:runDeletionJobChunk"),
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
      makeFunctionReference<"mutation">("deletionInternal:runDeletionJobChunk"),
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
      makeFunctionReference<"mutation">("deletionInternal:runDeletionJobChunk"),
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
      makeFunctionReference<"mutation">("deletionInternal:runDeletionJobChunk"),
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
      makeFunctionReference<"mutation">("deletionInternal:runDeletionJobChunk"),
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
      deletedCountsByTable: parseDeletedCounts(String(job.deletedCountsJson)),
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
        status: String(thread.status),
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

    const turns = await ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_startedAt")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
          q.eq(q.field("userId"), args.actor.userId),
          q.eq(q.field("threadId"), args.threadId),
        ),
      )
      .order("desc")
      .take(50);

    const streams = await ctx.db
      .query("codex_streams")
      .withIndex("userScope_threadId_state")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
          q.eq(q.field("threadId"), args.threadId),
        ),
      )
      .take(200);

    const stats = await ctx.db
      .query("codex_stream_stats")
      .withIndex("userScope_threadId", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId),
      )
      .take(500);

    const approvals = await ctx.db
      .query("codex_approvals")
      .withIndex("userScope_threadId_status")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
          q.eq(q.field("userId"), args.actor.userId),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("status"), "pending"),
        ),
      )
      .take(100);

    const recentMessages = await ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_createdAt", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId),
      )
      .order("desc")
      .take(20);

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

    const lifecycle = await ctx.db
      .query("codex_lifecycle_events")
      .withIndex("userScope_threadId_createdAt", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId),
      )
      .order("desc")
      .take(50);

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
          void error;
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
