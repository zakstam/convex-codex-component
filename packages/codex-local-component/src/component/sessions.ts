import { internal } from "./_generated/api.js";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { runDeletionJobChunkHandler } from "./deletionInternal.js";
import { now } from "./utils.js";

export const timeoutStaleSessions = internalMutation({
  args: {
    userScope: v.string(),
    staleBeforeMs: v.number(),
  },
  returns: v.object({ timedOut: v.number() }),
  handler: async (ctx, args) => {
    const stale = await ctx.db
      .query("codex_sessions")
      .withIndex("userScope_lastHeartbeatAt")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), args.userScope),
          q.lt(q.field("lastHeartbeatAt"), args.staleBeforeMs),
        ),
      )
      .take(500);

    let timedOut = 0;
    for (const session of stale) {
      if (session.status === "active" || session.status === "starting") {
        timedOut += 1;
        await ctx.db.patch(session._id, {
          status: "stale",
          endedAt: now(),
          error: "heartbeat timeout",
        });
      }
    }

    return { timedOut };
  },
});

export const runDeletionJobChunk = internalMutation({
  args: {
    userScope: v.string(),
    deletionJobId: v.string(),
    batchSize: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    runDeletionJobChunkHandler(ctx, args, async (nextArgs) => {
      await ctx.scheduler.runAfter(0, internal.sessions.runDeletionJobChunk, nextArgs);
    }),
});
