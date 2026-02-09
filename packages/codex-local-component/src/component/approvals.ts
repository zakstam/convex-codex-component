import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { vActorContext } from "./types.js";
import { authzError, now, requireThreadForActor } from "./utils.js";

export const listPending = query({
  args: {
    actor: vActorContext,
    threadId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    if (args.threadId) {
      await requireThreadForActor(ctx, args.actor, args.threadId);
    }

    const paginated = await ctx.db
      .query("codex_approvals")
      .withIndex("tenantId_threadId_status")
      .filter((q) => {
        const base = q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("userId"), args.actor.userId),
          q.eq(q.field("status"), "pending"),
        );
        return args.threadId
          ? q.and(base, q.eq(q.field("threadId"), args.threadId))
          : base;
      })
      .paginate(args.paginationOpts);

    return {
      ...paginated,
      page: paginated.page.map((approval) => ({
        threadId: String(approval.threadId),
        turnId: String(approval.turnId),
        itemId: String(approval.itemId),
        kind: String(approval.kind),
        reason: approval.reason ? String(approval.reason) : undefined,
        createdAt: Number(approval.createdAt),
      })),
    };
  },
});

export const respond = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const approval = await ctx.db
      .query("codex_approvals")
      .withIndex("tenantId_threadId_turnId_itemId")
      .filter((q) =>
        q.and(
          q.eq(q.field("tenantId"), args.actor.tenantId),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("turnId"), args.turnId),
          q.eq(q.field("itemId"), args.itemId),
        ),
      )
      .first();

    if (!approval) {
      throw new Error("Approval not found");
    }
    if (approval.userId !== args.actor.userId || approval.threadId !== args.threadId) {
      authzError(
        "E_AUTH_TURN_FORBIDDEN",
        `User ${args.actor.userId} is not allowed to respond to approval ${args.itemId}`,
      );
    }

    await ctx.db.patch(approval._id, {
      status: args.decision,
      decidedBy: args.actor.userId,
      decidedAt: now(),
    });

    return null;
  },
});
