import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx } from "./_generated/server.js";
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

function generateUuidV4(): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function touchThread(
  ctx: MutationCtx,
  args: {
    actor: { tenantId: string; userId: string };
    threadId: string;
    model?: string;
    cwd?: string;
    personality?: string;
    localThreadId?: string;
  },
): Promise<{ threadId: string; created: boolean }> {
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
    return { threadId: String(existing.threadId), created: false };
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

  return { threadId: args.threadId, created: true };
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
        .withIndex("tenantId_userId_externalThreadId", (q) =>
          q
            .eq("tenantId", args.actor.tenantId)
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
        tenantId: args.actor.tenantId,
        userId: args.actor.userId,
        externalThreadId,
        threadId: touched.threadId,
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
      .withIndex("tenantId_userId_externalThreadId", (q) =>
        q
          .eq("tenantId", args.actor.tenantId)
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
      .withIndex("tenantId_userId_threadId", (q) =>
        q
          .eq("tenantId", args.actor.tenantId)
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
