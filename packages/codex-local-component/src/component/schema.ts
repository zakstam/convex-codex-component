import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const vStreamState = v.union(
  v.object({
    kind: v.literal("streaming"),
    lastHeartbeatAt: v.number(),
    timeoutFnId: v.optional(v.id("_scheduled_functions")),
  }),
  v.object({
    kind: v.literal("finished"),
    endedAt: v.number(),
  }),
  v.object({
    kind: v.literal("aborted"),
    reason: v.string(),
    endedAt: v.number(),
  }),
);

export default defineSchema({
  codex_thread_bindings: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    externalThreadId: v.string(),
    threadId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_userId_externalThreadId", ["userScope", "userId", "externalThreadId"])
    .index("userScope_userId_threadId", ["userScope", "userId", "threadId"]),

  codex_threads: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    localThreadId: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived"), v.literal("failed")),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    personality: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_updatedAt", ["userScope", "updatedAt"])
    .index("userScope_userId_updatedAt_threadId", ["userScope", "userId", "updatedAt", "threadId"])
    .index("userScope_threadId", ["userScope", "threadId"]),

  codex_turns: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    turnId: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("inProgress"),
      v.literal("completed"),
      v.literal("interrupted"),
      v.literal("failed"),
    ),
    idempotencyKey: v.string(),
    inputSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("userScope_threadId_startedAt", ["userScope", "threadId", "startedAt"])
    .index("userScope_idempotencyKey", ["userScope", "idempotencyKey"])
    .index("userScope_threadId_turnId", ["userScope", "threadId", "turnId"]),

  codex_turn_dispatches: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    dispatchId: v.string(),
    turnId: v.string(),
    idempotencyKey: v.string(),
    inputText: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("started"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    claimOwner: v.optional(v.string()),
    claimToken: v.optional(v.string()),
    leaseExpiresAt: v.number(),
    attemptCount: v.number(),
    runtimeThreadId: v.optional(v.string()),
    runtimeTurnId: v.optional(v.string()),
    failureCode: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
  })
    .index("userScope_threadId_dispatchId", ["userScope", "threadId", "dispatchId"])
    .index("userScope_threadId_turnId", ["userScope", "threadId", "turnId"])
    .index("userScope_threadId_idempotencyKey", ["userScope", "threadId", "idempotencyKey"])
    .index("userScope_threadId_status_createdAt", ["userScope", "threadId", "status", "createdAt"])
    .index("userScope_threadId_status_leaseExpiresAt", ["userScope", "threadId", "status", "leaseExpiresAt"]),

  codex_items: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    itemType: v.string(),
    status: v.union(v.literal("inProgress"), v.literal("completed"), v.literal("failed"), v.literal("declined")),
    payloadJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_threadId_turnId_itemId", ["userScope", "threadId", "turnId", "itemId"])
    .index("userScope_threadId_createdAt", ["userScope", "threadId", "createdAt"]),

  codex_event_summaries: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    turnId: v.optional(v.string()),
    eventId: v.string(),
    kind: v.string(),
    summary: v.string(),
    createdAt: v.number(),
  }).index("userScope_threadId_createdAt", ["userScope", "threadId", "createdAt"]),

  codex_messages: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    turnId: v.string(),
    messageId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
    status: v.union(v.literal("streaming"), v.literal("completed"), v.literal("failed"), v.literal("interrupted")),
    text: v.string(),
    sourceItemType: v.string(),
    orderInTurn: v.number(),
    payloadJson: v.string(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("userScope_threadId_createdAt", ["userScope", "threadId", "createdAt"])
    .index("userScope_threadId_createdAt_messageId", ["userScope", "threadId", "createdAt", "messageId"])
    .index("userScope_threadId_turnId_createdAt", ["userScope", "threadId", "turnId", "createdAt"])
    .index("userScope_threadId_turnId_messageId", ["userScope", "threadId", "turnId", "messageId"])
    .index("userScope_threadId_turnId_orderInTurn", ["userScope", "threadId", "turnId", "orderInTurn"])
    .index("userScope_threadId_turnId_status", ["userScope", "threadId", "turnId", "status"]),

  codex_reasoning_segments: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    segmentId: v.string(),
    eventId: v.string(),
    channel: v.union(v.literal("summary"), v.literal("raw")),
    segmentType: v.union(v.literal("textDelta"), v.literal("sectionBreak")),
    text: v.string(),
    summaryIndex: v.optional(v.number()),
    contentIndex: v.optional(v.number()),
    cursorStart: v.number(),
    cursorEnd: v.number(),
    createdAt: v.number(),
  })
    .index("userScope_threadId_createdAt_segmentId", ["userScope", "threadId", "createdAt", "segmentId"])
    .index("userScope_threadId_turnId_itemId_createdAt", [
      "userScope",
      "threadId",
      "turnId",
      "itemId",
      "createdAt",
    ])
    .index("userScope_threadId_eventId", ["userScope", "threadId", "eventId"]),

  codex_sessions: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    sessionId: v.string(),
    status: v.union(
      v.literal("starting"),
      v.literal("active"),
      v.literal("stale"),
      v.literal("ended"),
      v.literal("failed"),
    ),
    lastHeartbeatAt: v.number(),
    lastEventCursor: v.number(),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("userScope_threadId", ["userScope", "threadId"])
    .index("userScope_lastHeartbeatAt", ["userScope", "lastHeartbeatAt"])
    .index("userScope_sessionId", ["userScope", "sessionId"]),

  codex_streams: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    streamId: v.string(),
    state: vStreamState,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    cleanupScheduledAt: v.optional(v.number()),
    cleanupFnId: v.optional(v.id("_scheduled_functions")),
  })
    .index("userScope_threadId_state", ["userScope", "threadId", "state.kind"])
    .index("userScope_threadId_turnId", ["userScope", "threadId", "turnId"])
    .index("userScope_streamId", ["userScope", "streamId"]),

  codex_stream_stats: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    streamId: v.string(),
    state: v.union(v.literal("streaming"), v.literal("finished"), v.literal("aborted")),
    deltaCount: v.number(),
    latestCursor: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_threadId", ["userScope", "threadId"])
    .index("userScope_streamId", ["userScope", "streamId"]),

  codex_stream_deltas_ttl: defineTable({
    userScope: v.string(),
    streamId: v.string(),
    turnId: v.string(),
    eventId: v.string(),
    cursorStart: v.number(),
    cursorEnd: v.number(),
    kind: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("userScope_streamId_cursorStart", ["userScope", "streamId", "cursorStart"])
    .index("userScope_streamId_eventId", ["userScope", "streamId", "eventId"])
    .index("expiresAt", ["expiresAt"]),

  codex_lifecycle_events: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    turnId: v.optional(v.string()),
    eventId: v.string(),
    kind: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  })
    .index("userScope_threadId_createdAt", ["userScope", "threadId", "createdAt"])
    .index("userScope_threadId_turnId_createdAt", ["userScope", "threadId", "turnId", "createdAt"])
    .index("userScope_threadId_eventId", ["userScope", "threadId", "eventId"]),

  codex_stream_checkpoints: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    streamId: v.string(),
    ackedCursor: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_threadId_streamId", ["userScope", "threadId", "streamId"]),

  codex_approvals: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    kind: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("declined")),
    reason: v.optional(v.string()),
    decidedBy: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("userScope_threadId_status", ["userScope", "threadId", "status"])
    .index(
      "userScope_userId_status_createdAt_threadId_itemId",
      ["userScope", "userId", "status", "createdAt", "threadId", "itemId"],
    )
    .index(
      "userScope_userId_threadId_status_createdAt_itemId",
      ["userScope", "userId", "threadId", "status", "createdAt", "itemId"],
    )
    .index("userScope_threadId_turnId_itemId", ["userScope", "threadId", "turnId", "itemId"]),

  codex_token_usage: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    turnId: v.string(),
    totalTokens: v.number(),
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    outputTokens: v.number(),
    reasoningOutputTokens: v.number(),
    lastTotalTokens: v.number(),
    lastInputTokens: v.number(),
    lastCachedInputTokens: v.number(),
    lastOutputTokens: v.number(),
    lastReasoningOutputTokens: v.number(),
    modelContextWindow: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_threadId_turnId", ["userScope", "threadId", "turnId"])
    .index("userScope_threadId_updatedAt", ["userScope", "threadId", "updatedAt"]),

  codex_server_requests: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    method: v.union(
      v.literal("item/commandExecution/requestApproval"),
      v.literal("item/fileChange/requestApproval"),
      v.literal("item/tool/requestUserInput"),
      v.literal("item/tool/call"),
    ),
    requestIdType: v.union(v.literal("string"), v.literal("number")),
    requestIdText: v.string(),
    payloadJson: v.string(),
    status: v.union(v.literal("pending"), v.literal("answered"), v.literal("expired")),
    reason: v.optional(v.string()),
    questionsJson: v.optional(v.string()),
    responseJson: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index(
      "userScope_threadId_requestIdType_requestIdText",
      ["userScope", "threadId", "requestIdType", "requestIdText"],
    )
    .index("userScope_userId_status_updatedAt", ["userScope", "userId", "status", "updatedAt"])
    .index(
      "userScope_userId_threadId_status_updatedAt",
      ["userScope", "userId", "threadId", "status", "updatedAt"],
    ),
});
