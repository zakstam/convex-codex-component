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
    tenantId: v.string(),
    userId: v.string(),
    externalThreadId: v.string(),
    threadId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("tenantId_userId_externalThreadId", ["tenantId", "userId", "externalThreadId"])
    .index("tenantId_userId_threadId", ["tenantId", "userId", "threadId"]),

  codex_threads: defineTable({
    tenantId: v.string(),
    userId: v.string(),
    threadId: v.string(),
    localThreadId: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived"), v.literal("failed")),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
    personality: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("tenantId_updatedAt", ["tenantId", "updatedAt"])
    .index("tenantId_userId_updatedAt_threadId", ["tenantId", "userId", "updatedAt", "threadId"])
    .index("tenantId_threadId", ["tenantId", "threadId"]),

  codex_turns: defineTable({
    tenantId: v.string(),
    userId: v.string(),
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
    .index("tenantId_threadId_startedAt", ["tenantId", "threadId", "startedAt"])
    .index("tenantId_idempotencyKey", ["tenantId", "idempotencyKey"])
    .index("tenantId_threadId_turnId", ["tenantId", "threadId", "turnId"]),

  codex_items: defineTable({
    tenantId: v.string(),
    userId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    itemType: v.string(),
    status: v.union(v.literal("inProgress"), v.literal("completed"), v.literal("failed"), v.literal("declined")),
    payloadJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("tenantId_threadId_turnId_itemId", ["tenantId", "threadId", "turnId", "itemId"])
    .index("tenantId_threadId_createdAt", ["tenantId", "threadId", "createdAt"]),

  codex_event_summaries: defineTable({
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.optional(v.string()),
    eventId: v.string(),
    kind: v.string(),
    summary: v.string(),
    createdAt: v.number(),
  }).index("tenantId_threadId_createdAt", ["tenantId", "threadId", "createdAt"]),

  codex_messages: defineTable({
    tenantId: v.string(),
    userId: v.string(),
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
    .index("tenantId_threadId_createdAt", ["tenantId", "threadId", "createdAt"])
    .index("tenantId_threadId_createdAt_messageId", ["tenantId", "threadId", "createdAt", "messageId"])
    .index("tenantId_threadId_turnId_createdAt", ["tenantId", "threadId", "turnId", "createdAt"])
    .index("tenantId_threadId_turnId_messageId", ["tenantId", "threadId", "turnId", "messageId"])
    .index("tenantId_threadId_turnId_orderInTurn", ["tenantId", "threadId", "turnId", "orderInTurn"])
    .index("tenantId_threadId_turnId_status", ["tenantId", "threadId", "turnId", "status"]),

  codex_reasoning_segments: defineTable({
    tenantId: v.string(),
    userId: v.string(),
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
    .index("tenantId_threadId_createdAt_segmentId", ["tenantId", "threadId", "createdAt", "segmentId"])
    .index("tenantId_threadId_turnId_itemId_createdAt", [
      "tenantId",
      "threadId",
      "turnId",
      "itemId",
      "createdAt",
    ])
    .index("tenantId_threadId_eventId", ["tenantId", "threadId", "eventId"]),

  codex_sessions: defineTable({
    tenantId: v.string(),
    userId: v.string(),
    deviceId: v.string(),
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
    .index("tenantId_threadId", ["tenantId", "threadId"])
    .index("tenantId_deviceId_status", ["tenantId", "deviceId", "status"])
    .index("tenantId_lastHeartbeatAt", ["tenantId", "lastHeartbeatAt"])
    .index("tenantId_sessionId", ["tenantId", "sessionId"]),

  codex_streams: defineTable({
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    streamId: v.string(),
    state: vStreamState,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    cleanupScheduledAt: v.optional(v.number()),
    cleanupFnId: v.optional(v.id("_scheduled_functions")),
  })
    .index("tenantId_threadId_state", ["tenantId", "threadId", "state.kind"])
    .index("tenantId_threadId_turnId", ["tenantId", "threadId", "turnId"])
    .index("tenantId_streamId", ["tenantId", "streamId"]),

  codex_stream_stats: defineTable({
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    streamId: v.string(),
    state: v.union(v.literal("streaming"), v.literal("finished"), v.literal("aborted")),
    deltaCount: v.number(),
    latestCursor: v.number(),
    updatedAt: v.number(),
  })
    .index("tenantId_threadId", ["tenantId", "threadId"])
    .index("tenantId_streamId", ["tenantId", "streamId"]),

  codex_stream_deltas_ttl: defineTable({
    tenantId: v.string(),
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
    .index("tenantId_streamId_cursorStart", ["tenantId", "streamId", "cursorStart"])
    .index("tenantId_streamId_eventId", ["tenantId", "streamId", "eventId"])
    .index("expiresAt", ["expiresAt"]),

  codex_lifecycle_events: defineTable({
    tenantId: v.string(),
    threadId: v.string(),
    turnId: v.optional(v.string()),
    eventId: v.string(),
    kind: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  })
    .index("tenantId_threadId_createdAt", ["tenantId", "threadId", "createdAt"])
    .index("tenantId_threadId_turnId_createdAt", ["tenantId", "threadId", "turnId", "createdAt"])
    .index("tenantId_threadId_eventId", ["tenantId", "threadId", "eventId"]),

  codex_stream_checkpoints: defineTable({
    tenantId: v.string(),
    userId: v.string(),
    deviceId: v.string(),
    threadId: v.string(),
    streamId: v.string(),
    ackedCursor: v.number(),
    updatedAt: v.number(),
  })
    .index("tenantId_threadId_deviceId_streamId", ["tenantId", "threadId", "deviceId", "streamId"])
    .index("tenantId_threadId_streamId", ["tenantId", "threadId", "streamId"]),

  codex_approvals: defineTable({
    tenantId: v.string(),
    userId: v.string(),
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
    .index("tenantId_threadId_status", ["tenantId", "threadId", "status"])
    .index(
      "tenantId_userId_status_createdAt_threadId_itemId",
      ["tenantId", "userId", "status", "createdAt", "threadId", "itemId"],
    )
    .index(
      "tenantId_userId_threadId_status_createdAt_itemId",
      ["tenantId", "userId", "threadId", "status", "createdAt", "itemId"],
    )
    .index("tenantId_threadId_turnId_itemId", ["tenantId", "threadId", "turnId", "itemId"]),

  codex_server_requests: defineTable({
    tenantId: v.string(),
    userId: v.string(),
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
      "tenantId_threadId_requestIdType_requestIdText",
      ["tenantId", "threadId", "requestIdType", "requestIdText"],
    )
    .index("tenantId_userId_status_updatedAt", ["tenantId", "userId", "status", "updatedAt"])
    .index(
      "tenantId_userId_threadId_status_updatedAt",
      ["tenantId", "userId", "threadId", "status", "updatedAt"],
    ),
});
