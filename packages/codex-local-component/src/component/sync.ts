import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { vActorContext, vSyncRuntimeOptions } from "./types.js";
import { heartbeatHandler, pushEventsHandler } from "./syncIngest.js";
import { pullStateHandler, resumeFromCursorHandler } from "./syncReplay.js";

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

export const pushEvents = mutation({
  args: {
    actor: vActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(vInboundEvent),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  returns: v.object({ ackCursor: v.number() }),
  handler: pushEventsHandler,
});

export const pullState = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    streamCursorsById: v.array(v.object({ streamId: v.string(), cursor: v.number() })),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  handler: pullStateHandler,
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

export const resumeFromCursor = query({
  args: {
    actor: vActorContext,
    threadId: v.string(),
    turnId: v.string(),
    fromCursor: v.number(),
    runtime: v.optional(vSyncRuntimeOptions),
  },
  handler: resumeFromCursorHandler,
});
