import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { now, requireThreadForActor, requireThreadRefForActor } from "./utils.js";

export const upsert = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    totalTokens: v.number(),
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    outputTokens: v.number(),
    reasoningOutputTokens: v.number(),
    lastTotalTokens: v.number(),
    lastInputTokens: v.number(),
    lastCachedInputTokens: v.number(),
    lastOutputTokens: v.number(),
    lastReasoningOutputTokens: v.number(),
    modelContextWindow: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
    const userScope = userScopeFromActor(args.actor);
    const turn = await ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_turnId", (q) =>
        q.eq("userScope", userScope).eq("threadId", args.threadId).eq("turnId", args.turnId),
      )
      .first();
    // Token usage can arrive before the persisted turn record is available
    // (for example runtime placeholder turn ids). Treat as best-effort.
    if (!turn) {
      return null;
    }
    const turnRef = turn._id;


    const existing = await ctx.db
      .query("codex_token_usage")
      .withIndex("userScope_threadId_turnId")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScope),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("turnId"), args.turnId),
        ),
      )
      .first();

    const timestamp = now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        threadRef,
        turnRef,
        totalTokens: args.totalTokens,
        inputTokens: args.inputTokens,
        cachedInputTokens: args.cachedInputTokens,
        outputTokens: args.outputTokens,
        reasoningOutputTokens: args.reasoningOutputTokens,
        lastTotalTokens: args.lastTotalTokens,
        lastInputTokens: args.lastInputTokens,
        lastCachedInputTokens: args.lastCachedInputTokens,
        lastOutputTokens: args.lastOutputTokens,
        lastReasoningOutputTokens: args.lastReasoningOutputTokens,
        ...(args.modelContextWindow !== undefined ? { modelContextWindow: args.modelContextWindow } : {}),
        updatedAt: timestamp,
      });
      return null;
    }

    await ctx.db.insert("codex_token_usage", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      threadId: args.threadId,
      threadRef,
      turnId: args.turnId,
      turnRef,
      totalTokens: args.totalTokens,
      inputTokens: args.inputTokens,
      cachedInputTokens: args.cachedInputTokens,
      outputTokens: args.outputTokens,
      reasoningOutputTokens: args.reasoningOutputTokens,
      lastTotalTokens: args.lastTotalTokens,
      lastInputTokens: args.lastInputTokens,
      lastCachedInputTokens: args.lastCachedInputTokens,
      lastOutputTokens: args.lastOutputTokens,
      lastReasoningOutputTokens: args.lastReasoningOutputTokens,
      ...(args.modelContextWindow !== undefined ? { modelContextWindow: args.modelContextWindow } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    return null;
  },
});

export const listByThread = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const userScope = userScopeFromActor(args.actor);

    const rows = await ctx.db
      .query("codex_token_usage")
      .withIndex("userScope_threadId_updatedAt")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScope),
          q.eq(q.field("threadId"), args.threadId),
        ),
      )
      .order("asc")
      .collect();

    return rows.map((row) => ({
      turnId: row.turnId,
      total: {
        totalTokens: row.totalTokens,
        inputTokens: row.inputTokens,
        cachedInputTokens: row.cachedInputTokens,
        outputTokens: row.outputTokens,
        reasoningOutputTokens: row.reasoningOutputTokens,
      },
      last: {
        totalTokens: row.lastTotalTokens,
        inputTokens: row.lastInputTokens,
        cachedInputTokens: row.lastCachedInputTokens,
        outputTokens: row.lastOutputTokens,
        reasoningOutputTokens: row.lastReasoningOutputTokens,
      },
      ...(row.modelContextWindow !== undefined ? { modelContextWindow: row.modelContextWindow } : {}),
      updatedAt: row.updatedAt,
    }));
  },
});
