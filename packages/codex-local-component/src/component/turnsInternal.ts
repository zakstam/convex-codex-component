import { v } from "convex/values";
import { internalMutation } from "./_generated/server.js";
import { now } from "./utils.js";

export const finalizeTurnFromStream = internalMutation({
  args: {
    userScope: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("interrupted")),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const turn = await ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_turnId")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), args.userScope),
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
