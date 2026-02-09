import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { vActorContext } from "./types.js";
import { requireThreadForActor, requireTurnForActor } from "./utils.js";

export const listByThread = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const result = await ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_createdAt", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("threadId", args.threadId),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...result,
      page: result.page.map((message) => ({
        messageId: String(message.messageId),
        turnId: String(message.turnId),
        role: message.role,
        status: message.status,
        text: String(message.text),
        sourceItemType: String(message.sourceItemType),
        orderInTurn: Number(message.orderInTurn),
        payloadJson: String(message.payloadJson),
        ...(message.error ? { error: String(message.error) } : {}),
        createdAt: Number(message.createdAt),
        updatedAt: Number(message.updatedAt),
        ...(typeof message.completedAt === "number"
          ? { completedAt: Number(message.completedAt) }
          : {}),
      })),
    };
  },
});

export const getByTurn = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
  },
  returns: v.array(
    v.object({
      messageId: v.string(),
      turnId: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
      status: v.union(v.literal("streaming"), v.literal("completed"), v.literal("failed"), v.literal("interrupted")),
      text: v.string(),
      sourceItemType: v.string(),
      orderInTurn: v.number(),
      payloadJson: v.string(),
      error: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, args) => {
    await requireTurnForActor(ctx, args.actor, args.threadId, args.turnId);

    const messages = await ctx.db
      .query("codex_messages")
      .withIndex("tenantId_threadId_turnId_orderInTurn", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("threadId", args.threadId).eq("turnId", args.turnId),
      )
      .order("asc")
      .take(500);

    return messages.map((message) => ({
      messageId: String(message.messageId),
      turnId: String(message.turnId),
      role: message.role,
      status: message.status,
      text: String(message.text),
      sourceItemType: String(message.sourceItemType),
      orderInTurn: Number(message.orderInTurn),
      payloadJson: String(message.payloadJson),
      ...(message.error ? { error: String(message.error) } : {}),
      createdAt: Number(message.createdAt),
      updatedAt: Number(message.updatedAt),
      ...(typeof message.completedAt === "number"
        ? { completedAt: Number(message.completedAt) }
        : {}),
    }));
  },
});
