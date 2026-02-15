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
import {
  vIngestResult,
  vIngestSafeResult,
  vLifecycleEvent,
  vStreamInboundEvent,
} from "./validators/syncValidators.js";

export const ingest = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    streamDeltas: v.array(vStreamInboundEvent),
    lifecycleEvents: v.array(vLifecycleEvent),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  returns: vIngestResult,
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
  returns: vIngestSafeResult,
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
