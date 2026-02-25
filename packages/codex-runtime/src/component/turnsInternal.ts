import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { internalMutation } from "./_generated/server.js";
import { setStreamStatState } from "./streamStats.js";
import { now } from "./utils.js";

const DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS = 300_000;
const DEFAULT_STREAM_DELETE_BATCH_SIZE = 500;

type TerminalTurnStatus = "completed" | "failed" | "interrupted";

const TERMINAL_STATUS_PRIORITY: Record<TerminalTurnStatus, number> = {
  completed: 1,
  interrupted: 2,
  failed: 3,
};

function isTerminalStatus(status: string): status is TerminalTurnStatus {
  return status === "completed" || status === "failed" || status === "interrupted";
}

function pickTerminalStatus(
  currentStatus: string,
  incomingStatus: TerminalTurnStatus,
): TerminalTurnStatus {
  if (!isTerminalStatus(currentStatus)) {
    return incomingStatus;
  }
  if (TERMINAL_STATUS_PRIORITY[currentStatus] > TERMINAL_STATUS_PRIORITY[incomingStatus]) {
    return currentStatus;
  }
  return incomingStatus;
}

export const reconcileTerminalArtifacts = internalMutation({
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

    const ts = now();
    const status = pickTerminalStatus(String(turn.status), args.status);
    const error =
      status === "completed"
        ? undefined
        : args.error ?? (typeof turn.error === "string" && turn.error.length > 0 ? turn.error : status);

    await ctx.db.patch(turn._id, {
      status,
      ...(status === "completed" ? { error: undefined } : { error }),
      completedAt: ts,
    });

    const streamingMessages = await ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_turnId_status", (q) =>
        q
          .eq("userScope", args.userScope)
          .eq("threadId", args.threadId)
          .eq("turnId", args.turnId)
          .eq("status", "streaming"),
      )
      .take(500);

    await Promise.all(
      streamingMessages.map((message) =>
        ctx.db.patch(message._id, {
          status,
          ...(status === "completed" ? { error: undefined } : { error }),
          updatedAt: ts,
          completedAt: ts,
        }),
      ),
    );

    const streams = await ctx.db
      .query("codex_streams")
      .withIndex("userScope_threadId_turnId")
      .filter((q) =>
        q.and(
          q.eq(q.field("userScope"), args.userScope),
          q.eq(q.field("threadId"), args.threadId),
          q.eq(q.field("turnId"), args.turnId),
        ),
      )
      .take(100);

    for (const stream of streams) {
      if (stream.state.kind !== "streaming") {
        continue;
      }

      const cleanupFnId = await ctx.scheduler.runAfter(
        DEFAULT_FINISHED_STREAM_DELETE_DELAY_MS,
        internal.streams.cleanupFinishedStream,
        {
          userScope: args.userScope,
          streamId: String(stream.streamId),
          batchSize: DEFAULT_STREAM_DELETE_BATCH_SIZE,
        },
      );

      if (status === "completed") {
        await ctx.db.patch(stream._id, {
          state: { kind: "finished", endedAt: ts },
          endedAt: ts,
          cleanupScheduledAt: ts,
          cleanupFnId,
        });
        await setStreamStatState(ctx, {
          userScope: args.userScope,
          threadId: args.threadId,
          turnId: args.turnId,
          streamId: String(stream.streamId),
          state: "finished",
        });
      } else {
        await ctx.db.patch(stream._id, {
          state: { kind: "aborted", reason: error ?? status, endedAt: ts },
          endedAt: ts,
          cleanupScheduledAt: ts,
          cleanupFnId,
        });
        await setStreamStatState(ctx, {
          userScope: args.userScope,
          threadId: args.threadId,
          turnId: args.turnId,
          streamId: String(stream.streamId),
          state: "aborted",
        });
      }
    }

    return null;
  },
});
