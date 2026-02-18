import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { authzError, now, requireThreadForActor } from "./utils.js";

const vPendingApproval = v.object({
  threadId: v.string(),
  turnId: v.string(),
  itemId: v.string(),
  kind: v.string(),
  reason: v.optional(v.string()),
  createdAt: v.number(),
});

const vPendingApprovalListResult = v.object({
  page: v.array(vPendingApproval),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

export const listPending = query({
  args: {
    actor: vActorContext,
    threadId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  returns: vPendingApprovalListResult,
  handler: async (ctx, args) => {
    if (args.threadId) {
      await requireThreadForActor(ctx, args.actor, args.threadId);
    }

    const userScope = userScopeFromActor(args.actor);
    const takeLimit = args.paginationOpts.numItems + 1;
    const cursor = decodeKeysetCursor<{ createdAt: number; threadId: string; itemId: string }>(
      args.paginationOpts.cursor,
    );

    let paginated;
    if (args.threadId) {
      const base = ctx.db
        .query("codex_approvals")
        .withIndex("userScope_userId_threadId_status_createdAt_itemId", (q) =>
          q
            .eq("userScope", userScope)
            .eq("userId", args.actor.userId)
            .eq("threadId", args.threadId!)
            .eq("status", "pending"),
        );
      const filtered = cursor
        ? base.filter((q) =>
            q.or(
              q.lt(q.field("createdAt"), cursor.createdAt),
              q.and(
                q.eq(q.field("createdAt"), cursor.createdAt),
                q.lt(q.field("itemId"), cursor.itemId),
              ),
            ),
          )
        : base;
      paginated = await filtered.order("desc").take(takeLimit);
    } else {
      const base = ctx.db
        .query("codex_approvals")
        .withIndex("userScope_userId_status_createdAt_threadId_itemId", (q) =>
          q
            .eq("userScope", userScope)
            .eq("userId", args.actor.userId)
            .eq("status", "pending"),
        );
      const filtered = cursor
        ? base.filter((q) =>
            q.or(
              q.lt(q.field("createdAt"), cursor.createdAt),
              q.and(
                q.eq(q.field("createdAt"), cursor.createdAt),
                q.or(
                  q.lt(q.field("threadId"), cursor.threadId),
                  q.and(
                    q.eq(q.field("threadId"), cursor.threadId),
                    q.lt(q.field("itemId"), cursor.itemId),
                  ),
                ),
              ),
            ),
          )
        : base;
      paginated = await filtered.order("desc").take(takeLimit);
    }

    const result = keysetPageResult(paginated, args.paginationOpts, (approval) => ({
      createdAt: Number(approval.createdAt),
      threadId: String(approval.threadId),
      itemId: String(approval.itemId),
    }));

    return {
      ...result,
      page: result.page.map((approval) => ({
        threadId: String(approval.threadId),
        turnId: String(approval.turnId),
        itemId: String(approval.itemId),
        kind: String(approval.kind),
        ...(approval.reason ? { reason: String(approval.reason) } : {}),
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
      .withIndex("userScope_threadId_turnId_itemId")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
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
