import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";

const vActorContext = v.object({
  tenantId: v.string(),
  userId: v.string(),
  deviceId: v.string(),
});

const TRUSTED_ACTOR = Object.freeze({
  tenantId: process.env.ACTOR_TENANT_ID ?? "demo-tenant",
  userId: process.env.ACTOR_USER_ID ?? "demo-user",
  deviceId: process.env.ACTOR_DEVICE_ID ?? "host-device",
});

function trustedActor(_actor: { tenantId: string; userId: string; deviceId: string }) {
  return TRUSTED_ACTOR;
}

const vStreamInboundEvent = v.object({
  type: v.literal("stream_delta"),
  eventId: v.string(),
  turnId: v.string(),
  streamId: v.string(),
  kind: v.string(),
  payloadJson: v.string(),
  cursorStart: v.number(),
  cursorEnd: v.number(),
  createdAt: v.number(),
});

const vLifecycleInboundEvent = v.object({
  type: v.literal("lifecycle_event"),
  eventId: v.string(),
  turnId: v.optional(v.string()),
  kind: v.string(),
  payloadJson: v.string(),
  createdAt: v.number(),
});

const vSyncRuntimeOptions = v.object({
  saveStreamDeltas: v.optional(v.boolean()),
  maxDeltasPerStreamRead: v.optional(v.number()),
  maxDeltasPerRequestRead: v.optional(v.number()),
  finishedStreamDeleteDelayMs: v.optional(v.number()),
});

const vIngestSafeResult = v.object({
  status: v.union(v.literal("ok"), v.literal("partial"), v.literal("session_recovered"), v.literal("rejected")),
  ingestStatus: v.union(v.literal("ok"), v.literal("partial")),
  ackedStreams: v.array(v.object({ streamId: v.string(), ackCursorEnd: v.number() })),
  recovery: v.optional(
    v.object({
      action: v.literal("session_rebound"),
      sessionId: v.string(),
      threadId: v.string(),
    }),
  ),
  errors: v.array(
    v.object({
      code: v.union(
        v.literal("SESSION_NOT_FOUND"),
        v.literal("SESSION_THREAD_MISMATCH"),
        v.literal("SESSION_DEVICE_MISMATCH"),
        v.literal("OUT_OF_ORDER"),
        v.literal("REPLAY_GAP"),
        v.literal("UNKNOWN"),
      ),
      message: v.string(),
      recoverable: v.boolean(),
    }),
  ),
});

const vStreamArgs = v.optional(
  v.union(
    v.object({
      kind: v.literal("list"),
      startOrder: v.optional(v.number()),
    }),
    v.object({
      kind: v.literal("deltas"),
      cursors: v.array(
        v.object({
          streamId: v.string(),
          cursor: v.number(),
        }),
      ),
    }),
  ),
);

export const ensureThread = mutation({
  args: {
    actor: vActorContext,
    externalThreadId: v.optional(v.string()),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.threads.resolve, {
      actor: trustedActor(args.actor),
      ...(args.externalThreadId !== undefined ? { externalThreadId: args.externalThreadId } : {}),
      ...(args.externalThreadId !== undefined ? { localThreadId: args.externalThreadId } : {}),
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
      actor: trustedActor(args.actor),
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
  returns: v.object({
    sessionId: v.string(),
    threadId: v.string(),
    status: v.union(v.literal("created"), v.literal("active")),
  }),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.sync.ensureSession, {
      actor: trustedActor(args.actor),
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
    event: v.union(vStreamInboundEvent, vLifecycleInboundEvent),
  },
  returns: vIngestSafeResult,
  handler: async (ctx, args) => {
    const streamDeltas =
      args.event.type === "stream_delta" ? [args.event] : [];
    const lifecycleEvents =
      args.event.type === "lifecycle_event" ? [args.event] : [];
    const pushed = await ctx.runMutation(components.codexLocal.sync.ingestSafe, {
      actor: trustedActor(args.actor),
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas,
      lifecycleEvents,
    });

    return pushed;
  },
});

export const ingestBatch = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(v.union(vStreamInboundEvent, vLifecycleInboundEvent)),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  returns: vIngestSafeResult,
  handler: async (ctx, args) => {
    if (args.deltas.length === 0) {
      throw new Error("ingestBatch requires at least one delta");
    }
    const streamDeltas = args.deltas.filter(
      (delta): delta is typeof args.deltas[number] & { type: "stream_delta" } =>
        delta.type === "stream_delta",
    );
    const lifecycleEvents = args.deltas.filter(
      (delta): delta is typeof args.deltas[number] & { type: "lifecycle_event" } =>
        delta.type === "lifecycle_event",
    );
    return await ctx.runMutation(components.codexLocal.sync.ingestSafe, {
      actor: trustedActor(args.actor),
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas,
      lifecycleEvents,
      ...(args.runtime !== undefined ? { runtime: args.runtime } : {}),
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
      actor: trustedActor(args.actor),
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
    const state = await ctx.runQuery(components.codexLocal.threads.getState, {
      actor: trustedActor(args.actor),
      threadId: args.threadId,
    });

    return {
      streamCount: state.streamStats.length,
      deltaCount: state.streamStats.reduce((sum: number, stream: { deltaCount: number }) => sum + stream.deltaCount, 0),
      latestCursorByStream: state.streamStats.map((stream: { streamId: string; latestCursor: number }) => ({
        streamId: stream.streamId,
        cursor: stream.latestCursor,
      })),
    };
  },
});

export const durableHistoryStats = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  returns: v.object({
    messageCountInPage: v.number(),
    latest: v.array(
      v.object({
        messageId: v.string(),
        turnId: v.string(),
        role: v.string(),
        status: v.string(),
        text: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const state = await ctx.runQuery(components.codexLocal.threads.getState, {
      actor: trustedActor(args.actor),
      threadId: args.threadId,
    });
    const page = state.recentMessages;

    return {
      messageCountInPage: page.length,
      latest: page.slice(0, 5).map((m: { messageId: string; turnId: string; role: string; status: string; text: string }) => ({
        messageId: m.messageId,
        turnId: m.turnId,
        role: m.role,
        status: m.status,
        text: m.text,
      })),
    };
  },
});

export const listThreadMessagesForHooks = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vStreamArgs,
    runtime: v.optional(vSyncRuntimeOptions),
  },
  handler: async (ctx, args) => {
    const paginated = await ctx.runQuery(components.codexLocal.messages.listByThread, {
      actor: trustedActor(args.actor),
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    const streams = args.streamArgs
      ? await ctx.runQuery(components.codexLocal.sync.replay, {
          actor: trustedActor(args.actor),
          threadId: args.threadId,
          streamCursorsById:
            args.streamArgs.kind === "deltas" ? args.streamArgs.cursors : [],
          ...(args.runtime !== undefined ? { runtime: args.runtime } : {}),
        })
      : undefined;

    if (args.streamArgs && args.streamArgs.kind === "deltas") {
      return {
        ...paginated,
        streams: streams
          ? {
              kind: "deltas" as const,
              deltas: streams.deltas,
              streamWindows: streams.streamWindows,
              nextCheckpoints: streams.nextCheckpoints,
            }
          : undefined,
      };
    }

    return {
      ...paginated,
      streams: streams
        ? {
            kind: "list" as const,
            streams: streams.streams,
          }
        : undefined,
    };
  },
});

export const listTurnMessagesForHooks = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.codexLocal.messages.getByTurn, args);
  },
});

export const listPendingApprovalsForHooks = query({
  args: {
    actor: vActorContext,
    threadId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.codexLocal.approvals.listPending, args);
  },
});

export const respondApprovalForHooks = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.approvals.respond, args);
  },
});

export const interruptTurnForHooks = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.turns.interrupt, args);
  },
});
