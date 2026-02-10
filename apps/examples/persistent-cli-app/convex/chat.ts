import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  getThreadState,
  interruptTurn,
  listMessages,
  listPendingApprovals,
  listTurnMessages,
  respondToApproval,
  startTurn,
  replayStreams,
} from "@zakstam/codex-local-component/client";

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
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.runMutation(components.codexLocal.threads.create, {
      actor: trustedActor(args.actor),
      threadId: args.threadId,
      localThreadId: args.threadId,
      model: args.model,
      cwd: args.cwd,
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
    return await startTurn(ctx, components.codexLocal, {
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
      options: {
        model: args.model,
        cwd: args.cwd,
      },
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
    event: vInboundEvent,
  },
  returns: vIngestSafeResult,
  handler: async (ctx, args) => {
    const pushed = await ctx.runMutation(components.codexLocal.sync.ingestSafe, {
      actor: trustedActor(args.actor),
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
    runtime: v.optional(vSyncRuntimeOptions),
  },
  returns: vIngestSafeResult,
  handler: async (ctx, args) => {
    if (args.deltas.length === 0) {
      throw new Error("ingestBatch requires at least one delta");
    }
    return await ctx.runMutation(components.codexLocal.sync.ingestSafe, {
      actor: trustedActor(args.actor),
      sessionId: args.sessionId,
      threadId: args.threadId,
      streamDeltas: args.deltas.map((delta) => ({ ...delta, type: "stream_delta" as const })),
      lifecycleEvents: [],
      runtime: args.runtime,
    });
  },
});

export const threadSnapshot = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await getThreadState(ctx, components.codexLocal, {
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
    const state = await getThreadState(ctx, components.codexLocal, {
      actor: trustedActor(args.actor),
      threadId: args.threadId,
    });

    return {
      streamCount: state.streamStats.length,
      deltaCount: state.streamStats.reduce((sum, stream) => sum + stream.deltaCount, 0),
      latestCursorByStream: state.streamStats.map((stream) => ({
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
    const state = await getThreadState(ctx, components.codexLocal, {
      actor: trustedActor(args.actor),
      threadId: args.threadId,
    });
    const page = state.recentMessages;

    return {
      messageCountInPage: page.length,
      latest: page.slice(0, 5).map((m) => ({
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
    const paginated = await listMessages(ctx, components.codexLocal, {
      actor: trustedActor(args.actor),
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
    });

    const streams = args.streamArgs
      ? await replayStreams(ctx, components.codexLocal, {
          actor: trustedActor(args.actor),
          threadId: args.threadId,
          streamCursorsById:
            args.streamArgs.kind === "deltas" ? args.streamArgs.cursors : [],
          runtime: args.runtime,
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
    return await listTurnMessages(ctx, components.codexLocal, args);
  },
});

export const listPendingApprovalsForHooks = query({
  args: {
    actor: vActorContext,
    threadId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await listPendingApprovals(ctx, components.codexLocal, args);
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
  returns: v.object({
    sessionId: v.string(),
    threadId: v.string(),
    status: v.union(v.literal("created"), v.literal("active")),
  }),
  handler: async (ctx, args) => {
    return await respondToApproval(ctx, components.codexLocal, args);
  },
});

export const interruptTurnForHooks = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    sessionId: v.string(),
    threadId: v.string(),
    status: v.union(v.literal("created"), v.literal("active")),
  }),
  handler: async (ctx, args) => {
    return await interruptTurn(ctx, components.codexLocal, args);
  },
});
