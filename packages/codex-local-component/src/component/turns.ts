import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { vActorContext, vThreadInputItem, vTurnOptions } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { now, requireThreadForActor, requireTurnForActor, summarizeInput } from "./utils.js";

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
      .withIndex("userScope_idempotencyKey")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
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
      userScope: userScopeFromActor(args.actor),
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
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
    await requireTurnForActor(ctx, args.actor, args.threadId, args.turnId);

    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("turnsInternal:reconcileTerminalArtifacts"),
      {
        userScope: userScopeFromActor(args.actor),
        threadId: args.threadId,
        turnId: args.turnId,
        status: "interrupted",
        error: args.reason ?? "interrupted",
      },
    );

    return null;
  },
});
