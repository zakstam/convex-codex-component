import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server.js";
import { vActorContext, vThreadInputItem, vTurnOptions } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import {
  now,
  requireThreadForActor,
  requireThreadRefForActor,
  requireTurnForActor,
  requireTurnRefForActor,
  summarizeInput,
} from "./utils.js";
import { generateUuidV4, clampDeleteDelayMs } from "./deletionUtils.js";

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
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);

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
      threadRef,
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

export const deleteCascade = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({ deletionJobId: v.string() }),
  handler: async (ctx, args) => {
    const { threadRef } = await requireThreadRefForActor(ctx, args.actor, args.threadId);
    const { turnRef } = await requireTurnRefForActor(ctx, args.actor, args.threadId, args.turnId);

    const deletionJobId = generateUuidV4();
    const ts = now();
    const userScope = userScopeFromActor(args.actor);

    await ctx.db.insert("codex_deletion_jobs", {
      userScope,
      ...(args.actor.userId !== undefined ? { userId: args.actor.userId } : {}),
      deletionJobId,
      targetKind: "turn",
      threadId: args.threadId,
      threadRef,
      turnId: args.turnId,
      turnRef,
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
    turnId: v.string(),
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
    const { turnRef } = await requireTurnRefForActor(ctx, args.actor, args.threadId, args.turnId);

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
      targetKind: "turn",
      threadId: args.threadId,
      threadRef,
      turnId: args.turnId,
      turnRef,
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
