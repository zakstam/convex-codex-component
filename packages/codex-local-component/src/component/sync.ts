import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { vActorContext, vSyncRuntimeOptions } from "./types.js";
import { heartbeatHandler, ingestHandler, upsertCheckpointHandler } from "./syncIngest.js";
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
