import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { requireThreadForActor, requireTurnForActor } from "./utils.js";
import { isThreadMissing } from "../errors.js";

export const listByThread = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    try {
      await requireThreadForActor(ctx, args.actor, args.threadId);
    } catch (error) {
      if (isThreadMissing(error)) {
        return {
          page: [],
          isDone: true,
          continueCursor: args.paginationOpts.cursor ?? "",
        };
      }
      throw error;
    }

    const cursor = decodeKeysetCursor<{ createdAt: number; messageId: string }>(
      args.paginationOpts.cursor,
    );

    const scanned = await ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_createdAt_messageId", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId),
      )
      .filter((q) =>
        cursor
          ? q.or(
              q.lt(q.field("createdAt"), cursor.createdAt),
              q.and(
                q.eq(q.field("createdAt"), cursor.createdAt),
                q.lt(q.field("messageId"), cursor.messageId),
              ),
            )
          : q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
      )
      .order("desc")
      .take(args.paginationOpts.numItems + 1);

    const result = keysetPageResult(scanned, args.paginationOpts, (message) => ({
      createdAt: Number(message.createdAt),
      messageId: String(message.messageId),
    }));

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
      .withIndex("userScope_threadId_turnId_orderInTurn", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId).eq("turnId", args.turnId),
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
