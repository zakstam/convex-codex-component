import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { authzError, now, requireThreadForActor } from "./utils.js";

const vThreadState = v.object({
  threadId: v.string(),
  threadStatus: v.string(),
  turns: v.array(
    v.object({
      turnId: v.string(),
      status: v.string(),
      startedAt: v.number(),
    }),
  ),
  activeStreams: v.array(
    v.object({
      streamId: v.string(),
      state: v.string(),
    }),
  ),
  allStreams: v.array(
    v.object({
      streamId: v.string(),
      state: v.string(),
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
    }),
  ),
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
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("codex_threads")
      .withIndex("tenantId_threadId")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
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
      return { threadId: String(existing.threadId) };
    }

    await ctx.db.insert("codex_threads", {
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      threadId: args.threadId,
      status: "active",
      ...(args.localThreadId ? { localThreadId: args.localThreadId } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.cwd ? { cwd: args.cwd } : {}),
      ...(args.personality ? { personality: args.personality } : {}),
      createdAt: ts,
      updatedAt: ts,
    });
    return { threadId: args.threadId };
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
      .withIndex("tenantId_userId_updatedAt_threadId", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("userId", args.actor.userId),
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
          : q.eq(q.field("tenantId"), args.actor.tenantId),
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
      .withIndex("tenantId_threadId_startedAt")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("userId"), args.actor.userId),
          q.eq(q.field("threadId"), args.threadId),
        ),
      )
      .order("desc")
      .take(50);

    const streams = await ctx.db
      .query("codex_streams")
      .withIndex("tenantId_threadId_state")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("threadId"), args.threadId),
        ),
      )
      .take(200);

    const stats = await ctx.db
      .query("codex_stream_stats")
      .withIndex("tenantId_threadId", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("threadId", args.threadId),
      )
      .take(500);

    const approvals = await ctx.db
      .query("codex_approvals")
      .withIndex("tenantId_threadId_status")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("userId"), args.actor.userId),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("status"), "pending"),
        ),
      )
      .take(100);

    const recentMessages = await ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_createdAt", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("threadId", args.threadId),
      )
      .order("desc")
      .take(20);

    const allStreams = streams.map((stream) => ({
      streamId: String(stream.streamId),
      state: String(stream.state.kind),
    }));

    return {
      threadId: String(thread.threadId),
      threadStatus: String(thread.status),
      turns: turns.map((turn) => ({
        turnId: String(turn.turnId),
        status: String(turn.status),
        startedAt: Number(turn.startedAt),
      })),
      activeStreams: allStreams.filter((stream) => stream.state === "streaming"),
      allStreams,
      streamStats: stats.map((stat) => ({
        streamId: String(stat.streamId),
        state: stat.state,
        deltaCount: Number(stat.deltaCount),
        latestCursor: Number(stat.latestCursor),
      })),
      pendingApprovals: approvals.map((approval) => ({
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
      })),
    };
  },
});
