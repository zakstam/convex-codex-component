import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { vActorContext, vSyncRuntimeOptions } from "./types.js";
import {
  ensureSessionHandler,
  heartbeatHandler,
  ingestHandler,
  ingestSafeHandler,
  upsertCheckpointHandler,
} from "./syncIngest.js";
import { listCheckpointsHandler, replayHandler, resumeReplayHandler } from "./syncReplay.js";

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

const vLifecycleEvent = v.object({
  type: v.literal("lifecycle_event"),
  eventId: v.string(),
  turnId: v.optional(v.string()),
  kind: v.string(),
  payloadJson: v.string(),
  createdAt: v.number(),
});

export const ingest = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    streamDeltas: v.array(vStreamInboundEvent),
    lifecycleEvents: v.array(vLifecycleEvent),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  returns: v.object({
    ackedStreams: v.array(
      v.object({
        streamId: v.string(),
        ackCursorEnd: v.number(),
      }),
    ),
    ingestStatus: v.union(v.literal("ok"), v.literal("partial")),
  }),
  handler: ingestHandler,
});

export const ingestSafe = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    streamDeltas: v.array(vStreamInboundEvent),
    lifecycleEvents: v.array(vLifecycleEvent),
    ensureLastEventCursor: v.optional(v.number()),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  returns: v.object({
    status: v.union(v.literal("ok"), v.literal("partial"), v.literal("session_recovered"), v.literal("rejected")),
    ingestStatus: v.union(v.literal("ok"), v.literal("partial")),
    ackedStreams: v.array(
      v.object({
        streamId: v.string(),
        ackCursorEnd: v.number(),
      }),
    ),
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
          v.literal("TURN_ID_REQUIRED_FOR_TURN_EVENT"),
          v.literal("TURN_ID_REQUIRED_FOR_CODEX_EVENT"),
          v.literal("OUT_OF_ORDER"),
          v.literal("REPLAY_GAP"),
          v.literal("UNKNOWN"),
        ),
        message: v.string(),
        recoverable: v.boolean(),
      }),
    ),
  }),
  handler: ingestSafeHandler,
});

export const replay = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    streamCursorsById: v.array(v.object({ streamId: v.string(), cursor: v.number() })),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  handler: replayHandler,
});

export const listCheckpoints = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
  },
  handler: listCheckpointsHandler,
});

export const upsertCheckpoint = mutation({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    streamId: v.string(),
    cursor: v.number(),
  },
  returns: v.object({ ok: v.literal(true) }),
  handler: upsertCheckpointHandler,
});

export const heartbeat = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    lastEventCursor: v.number(),
  },
  returns: v.null(),
  handler: heartbeatHandler,
});

export const ensureSession = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    lastEventCursor: v.number(),
  },
  returns: v.object({
    sessionId: v.string(),
    threadId: v.string(),
    status: v.union(v.literal("created"), v.literal("active")),
  }),
  handler: ensureSessionHandler,
});

export const resumeReplay = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    fromCursor: v.number(),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  handler: resumeReplayHandler,
});
