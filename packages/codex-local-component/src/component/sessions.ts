import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
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
