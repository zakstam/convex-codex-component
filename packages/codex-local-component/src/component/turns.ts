import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { setStreamStatState } from "./streamStats.js";
import { vActorContext, vThreadInputItem, vTurnOptions } from "./types.js";
import { authzError, now, requireThreadForActor, requireTurnForActor, summarizeInput } from "./utils.js";

const DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS = 300_000;
const DEFAULT_STREAM_DELETE_BATCH_SIZE = 500;

export const start = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    input: v.array(vThreadInputItem),
    options: v.optional(vTurnOptions),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const existing = await ctx.db
      .query("codex_turns")
      .withIndex("tenantId_idempotencyKey")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("userId"), args.actor.userId),
          q.eq(q.field("idempotencyKey"), args.idempotencyKey),
        ),
      )
      .first();

    if (existing) {
      return { turnId: String(existing.turnId), accepted: true };
    }

    const ts = now();
    await ctx.db.insert("codex_turns", {
      tenantId: args.actor.tenantId,
      userId: args.actor.userId,
      threadId: args.threadId,
      turnId: args.turnId,
      status: "queued",
      idempotencyKey: args.idempotencyKey,
      inputSummary: summarizeInput(args.input),
      startedAt: ts,
    });

    return { turnId: args.turnId, accepted: true };
  },
});

export const interrupt = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);
    const turn = await requireTurnForActor(ctx, args.actor, args.threadId, args.turnId);

    await ctx.db.patch(turn._id, {
      status: "interrupted",
      completedAt: now(),
      error: args.reason ?? "interrupted",
    });

    const streams = await ctx.db
      .query("codex_streams")
      .withIndex("tenantId_threadId_turnId")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("turnId"), args.turnId),
        ),
      )
      .take(100);

    for (const stream of streams) {
      if (stream.state.kind !== "streaming") {
        continue;
      }

      const endedAt = now();
      const cleanupFnId = await ctx.scheduler.runAfter(
        DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS,
        makeFunctionReference<"mutation">("streams:cleanupFinishedStream"),
        {
          tenantId: args.actor.tenantId,
          streamId: String(stream.streamId),
          batchSize: DEFAULT_STREAM_DELETE_BATCH_SIZE,
        },
      );

      await ctx.db.patch(stream._id, {
        state: {
          kind: "aborted",
          reason: args.reason ?? "interrupted",
          endedAt,
        },
        endedAt,
        cleanupScheduledAt: endedAt,
        cleanupFnId,
      });

      await setStreamStatState(ctx, {
        tenantId: args.actor.tenantId,
        threadId: args.threadId,
        turnId: args.turnId,
        streamId: String(stream.streamId),
        state: "aborted",
      });
    }

    return null;
  },
});
