import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server.js";
import { decodeKeysetCursor, keysetPageResult } from "./pagination.js";
import { vActorContext } from "./types.js";
import { userScopeFromActor } from "./scope.js";
import { requireThreadForActor } from "./utils.js";

const vReasoningSegment = v.object({
  segmentId: v.string(),
  eventId: v.string(),
  turnId: v.string(),
  itemId: v.string(),
  channel: v.union(v.literal("summary"), v.literal("raw")),
  segmentType: v.union(v.literal("textDelta"), v.literal("sectionBreak")),
  text: v.string(),
  summaryIndex: v.optional(v.number()),
  contentIndex: v.optional(v.number()),
  cursorStart: v.number(),
  cursorEnd: v.number(),
  createdAt: v.number(),
});

const vReasoningListResult = v.object({
  page: v.array(vReasoningSegment),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

export const listByThread = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    includeRaw: v.optional(v.boolean()),
  },
  returns: vReasoningListResult,
  handler: async (ctx, args) => {
    await requireThreadForActor(ctx, args.actor, args.threadId);

    const cursor = decodeKeysetCursor<{ createdAt: number; segmentId: string }>(
      args.paginationOpts.cursor,
    );

    const scanned = await ctx.db
      .query("codex_reasoning_segments")
      .withIndex("userScope_threadId_createdAt_segmentId", (q) =>
        q.eq("userScope", userScopeFromActor(args.actor)).eq("threadId", args.threadId),
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
            : q.eq(q.field("userScope"), userScopeFromActor(args.actor)),
          args.includeRaw ? q.eq(q.field("userScope"), userScopeFromActor(args.actor)) : q.eq(q.field("channel"), "summary"),
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
