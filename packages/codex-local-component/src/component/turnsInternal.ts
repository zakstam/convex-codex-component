import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { ensureStreamStat } from "./streamStats.js";
import { vActorContext, vThreadInputItem, vTurnOptions } from "./types.js";
import { now } from "./utils.js";

export const startExecution = internalMutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    input: v.array(vThreadInputItem),
    options: v.optional(vTurnOptions),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("codex_turns")
      .withIndex("tenantId_threadId_turnId")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("turnId"), args.turnId),
        ),
      )
      .first();

    if (!turn) {
      throw new Error(`Turn not found: ${args.turnId}`);
    }

    await ctx.db.patch(turn._id, { status: "inProgress" });

    const streamId = `${args.threadId}:${args.turnId}:0`;
    const existingStream = await ctx.db
      .query("codex_streams")
      .withIndex("tenantId_streamId")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("streamId"), streamId),
        ),
      )
      .first();

    if (!existingStream) {
      await ctx.db.insert("codex_streams", {
        tenantId: args.actor.tenantId,
        threadId: args.threadId,
        turnId: args.turnId,
        streamId,
        state: {
          kind: "streaming",
          lastHeartbeatAt: now(),
        },
        startedAt: now(),
      });
    }

    await ensureStreamStat(ctx, {
      tenantId: args.actor.tenantId,
      threadId: args.threadId,
      turnId: args.turnId,
      streamId,
      state: "streaming",
    });

    await ctx.db.insert("codex_event_summaries", {
      tenantId: args.actor.tenantId,
      threadId: args.threadId,
      turnId: args.turnId,
      eventId: `${args.turnId}:queued`,
      kind: "turn/started",
      summary: "Turn execution scheduled for local Codex runtime",
      createdAt: now(),
    });

    return null;
  },
});

export const finalizeTurnFromStream = internalMutation({
  args: {
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("interrupted")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("codex_turns")
      .withIndex("tenantId_threadId_turnId")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.tenantId),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("turnId"), args.turnId),
        ),
      )
      .first();

    if (!turn) {
      return null;
    }

    await ctx.db.patch(turn._id, {
      status: args.status,
      error: args.error,
      completedAt: now(),
    });

    return null;
  },
});
