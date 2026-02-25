import { v } from "convex/values";

export const vStreamInboundEvent = v.object({
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

export const vLifecycleEvent = v.object({
  type: v.literal("lifecycle_event"),
  eventId: v.string(),
  turnId: v.optional(v.string()),
  kind: v.string(),
  payloadJson: v.string(),
  createdAt: v.number(),
});

export const vIngestResult = v.object({
  ackedStreams: v.array(
    v.object({
      streamId: v.string(),
      ackCursorEnd: v.number(),
    }),
  ),
  ingestStatus: v.union(v.literal("ok"), v.literal("partial")),
});

export const vIngestSafeResult = v.object({
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
        v.literal("TURN_ID_MISMATCH"),
        v.literal("OUT_OF_ORDER"),
        v.literal("REPLAY_GAP"),
        v.literal("UNKNOWN"),
      ),
      message: v.string(),
      recoverable: v.boolean(),
    }),
  ),
});

export const vReplayWindow = v.object({
  streamId: v.string(),
  status: v.union(v.literal("ok"), v.literal("rebased"), v.literal("stale")),
  serverCursorStart: v.number(),
  serverCursorEnd: v.number(),
});

export const vReplayDelta = v.object({
  streamId: v.string(),
  cursorStart: v.number(),
  cursorEnd: v.number(),
  kind: v.string(),
  payloadJson: v.string(),
});

export const vReplaySnapshot = v.object({
  itemId: v.string(),
  itemType: v.string(),
  status: v.string(),
  payloadJson: v.string(),
});

export const vReplayResult = v.object({
  streams: v.array(
    v.object({
      streamId: v.string(),
      state: v.string(),
    }),
  ),
  streamWindows: v.array(vReplayWindow),
  nextCheckpoints: v.array(
    v.object({
      streamId: v.string(),
      cursor: v.number(),
    }),
  ),
  deltas: v.array(vReplayDelta),
  snapshots: v.array(vReplaySnapshot),
});

export const vListCheckpointsResult = v.array(
  v.object({
    streamId: v.string(),
    cursor: v.number(),
  }),
);

export const vResumeReplayResult = v.object({
  streamWindow: vReplayWindow,
  deltas: v.array(
    v.object({
      cursorStart: v.number(),
      cursorEnd: v.number(),
      kind: v.string(),
      payloadJson: v.string(),
    }),
  ),
  nextCursor: v.number(),
});
