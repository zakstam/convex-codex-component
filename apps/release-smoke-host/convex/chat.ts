import { v } from "convex/values";
import type { FunctionReturnType } from "convex/server";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";

const vActorContext = v.object({
  tenantId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
});

const vInboundEvent = v.object({
  eventId: v.string(),
  turnId: v.string(),
  streamId: v.string(),
  kind: v.string(),
  payloadJson: v.string(),
  cursorStart: v.number(),
  cursorEnd: v.number(),
  createdAt: v.number(),
});

type ThreadState = FunctionReturnType<typeof components.codexLocal.threads.getState>;

type StreamStatSummary = {
  streamId: string;
  deltaCount: number;
  latestCursor: number;
};

function isStreamStatSummary(value: unknown): value is StreamStatSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.streamId === "string" &&
    typeof record.deltaCount === "number" &&
    typeof record.latestCursor === "number"
  );
}

export const ensureThread = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.threads.create, {
      actor: args.actor,
      threadId: args.threadId,
      localThreadId: args.threadId,
      ...(args.model !== undefined ? { model: args.model } : {}),
      ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
    });
  },
});

export const registerTurnStart = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    inputText: v.string(),
    idempotencyKey: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.turns.start, {
      actor: args.actor,
      threadId: args.threadId,
      turnId: args.turnId,
      idempotencyKey: args.idempotencyKey,
      input: [
        {
          type: "text",
          text: args.inputText,
        },
      ],
      ...(args.model !== undefined || args.cwd !== undefined
        ? {
            options: {
              ...(args.model !== undefined ? { model: args.model } : {}),
              ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
            },
          }
        : {}),
    });
  },
});

export const ensureSession = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.sync.heartbeat, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      lastEventCursor: 0,
    });
  },
});

export const ingestEvent = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    event: vInboundEvent,
  },
  returns: v.object({
    ackedStreams: v.array(v.object({ streamId: v.string(), ackCursorEnd: v.number() })),
    ingestStatus: v.union(v.literal("ok"), v.literal("partial")),
  }),
  handler: async (ctx, args) => {
    const pushed = await ctx.runMutation(components.codexLocal.sync.ingest, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas: [{ ...args.event, type: "stream_delta" as const }],
      lifecycleEvents: [],
    });

    return pushed;
  },
});

export const ingestBatch = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(vInboundEvent),
  },
  returns: v.object({
    ackedStreams: v.array(v.object({ streamId: v.string(), ackCursorEnd: v.number() })),
    ingestStatus: v.union(v.literal("ok"), v.literal("partial")),
  }),
  handler: async (ctx, args) => {
    if (args.deltas.length === 0) {
      throw new Error("ingestBatch requires at least one delta");
    }
    return await ctx.runMutation(components.codexLocal.sync.ingest, {
      actor: args.actor,
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas: args.deltas.map((delta) => ({ ...delta, type: "stream_delta" as const })),
      lifecycleEvents: [],
    });
  },
});

export const threadSnapshot = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.codexLocal.threads.getState, {
      actor: args.actor,
      threadId: args.threadId,
    });
  },
});

export const persistenceStats = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: v.object({
    streamCount: v.number(),
    deltaCount: v.number(),
    latestCursorByStream: v.array(v.object({ streamId: v.string(), cursor: v.number() })),
  }),
  handler: async (ctx, args) => {
    const state: ThreadState = await ctx.runQuery(components.codexLocal.threads.getState, {
      actor: args.actor,
      threadId: args.threadId,
    });

    const streamStatsRaw = state?.streamStats;
    const streamStats = Array.isArray(streamStatsRaw)
      ? streamStatsRaw.filter((value) => isStreamStatSummary(value))
      : [];

    return {
      streamCount: streamStats.length,
      deltaCount: streamStats.reduce((sum, stream) => sum + stream.deltaCount, 0),
      latestCursorByStream: streamStats.map((stream) => ({
        streamId: stream.streamId,
        cursor: stream.latestCursor,
      })),
    };
  },
});

export const dataHygiene = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: v.object({
    scannedStreamStats: v.number(),
    streamStatOrphans: v.number(),
    orphanStreamIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const state: ThreadState = await ctx.runQuery(components.codexLocal.threads.getState, {
      actor: args.actor,
      threadId: args.threadId,
    });

    const streamStatsRaw = Array.isArray(state?.streamStats) ? state.streamStats : [];
    const allStreamsRaw = Array.isArray(state?.allStreams) ? state.allStreams : [];

    const liveStreamIds = new Set(allStreamsRaw.map((stream) => String(stream.streamId)));

    const streamStats = streamStatsRaw.filter((value) => isStreamStatSummary(value));
    const orphanStreamIds = streamStats
      .filter((stat) => !liveStreamIds.has(stat.streamId))
      .map((stat) => stat.streamId);

    return {
      scannedStreamStats: streamStats.length,
      streamStatOrphans: orphanStreamIds.length,
      orphanStreamIds,
    };
  },
});
