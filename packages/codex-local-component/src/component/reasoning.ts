import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { requireThreadForActor } from "./utils.js";

export const listByThread = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    includeRaw: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const cursor = decodeKeysetCursor<{ createdAt: number; segmentId: string }>(
      args.paginationOpts.cursor,
    );

    const scanned = await ctx.db
      .query("codex_reasoning_segments")
      .withIndex("tenantId_threadId_createdAt_segmentId", (q) =>
        q.eq("tenantId", args.actor.tenantId).eq("threadId", args.threadId),
      )
      .filter((q) =>
        q.and(
          cursor
            ? q.or(
                q.lt(q.field("createdAt"), cursor.createdAt),
                q.and(
                  q.eq(q.field("createdAt"), cursor.createdAt),
                  q.lt(q.field("segmentId"), cursor.segmentId),
                ),
              )
            : q.eq(q.field("tenantId"), args.actor.tenantId),
          args.includeRaw ? q.eq(q.field("tenantId"), args.actor.tenantId) : q.eq(q.field("channel"), "summary"),
        ),
      )
      .order("desc")
      .take(args.paginationOpts.numItems + 1);

    const result = keysetPageResult(scanned, args.paginationOpts, (segment) => ({
      createdAt: Number(segment.createdAt),
      segmentId: String(segment.segmentId),
    }));

    return {
      ...result,
      page: result.page.map((segment) => ({
        segmentId: String(segment.segmentId),
        eventId: String(segment.eventId),
        turnId: String(segment.turnId),
        itemId: String(segment.itemId),
        channel: segment.channel,
        segmentType: segment.segmentType,
        text: String(segment.text),
        ...(typeof segment.summaryIndex === "number" ? { summaryIndex: Number(segment.summaryIndex) } : {}),
        ...(typeof segment.contentIndex === "number" ? { contentIndex: Number(segment.contentIndex) } : {}),
        cursorStart: Number(segment.cursorStart),
        cursorEnd: Number(segment.cursorEnd),
        createdAt: Number(segment.createdAt),
      })),
    };
  },
});
