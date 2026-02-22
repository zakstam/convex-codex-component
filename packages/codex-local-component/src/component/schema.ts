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
  codex_sync_jobs: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    conversationId: v.string(),
    threadId: v.string(),
    runtimeConversationId: v.optional(v.string()),
    jobId: v.string(),
    policyVersion: v.number(),
    state: v.union(
      v.literal("idle"),
      v.literal("syncing"),
      v.literal("synced"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
    lastCursor: v.number(),
    processedChunkIndex: v.number(),
    totalChunks: v.number(),
    processedMessageCount: v.number(),
    expectedMessageCount: v.optional(v.number()),
    expectedMessageIdsJson: v.optional(v.string()),
    retryCount: v.number(),
    nextRunAt: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
    lastErrorMessage: v.optional(v.string()),
    sourceState: v.union(v.literal("collecting"), v.literal("sealed"), v.literal("processing")),
    sourceChecksum: v.optional(v.string()),
  })
    .index("userScope_userId_conversationId_startedAt", ["userScope", "userId", "conversationId", "startedAt"])
    .index("userScope_jobId", ["userScope", "jobId"]),

  codex_sync_job_chunks: defineTable({
    userScope: v.string(),
    jobRef: v.id("codex_sync_jobs"),
    chunkIndex: v.number(),
    payloadJson: v.string(),
    messageCount: v.number(),
    byteSize: v.number(),
    createdAt: v.number(),
  })
    .index("userScope_jobRef_chunkIndex", ["userScope", "jobRef", "chunkIndex"]),

  codex_thread_bindings: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    conversationId: v.string(),
    runtimeConversationId: v.optional(v.string()),
    threadId: v.string(),
    conversationRef: v.id("codex_threads"),
    syncState: v.optional(
      v.union(
        v.literal("unsynced"),
        v.literal("syncing"),
        v.literal("synced"),
        v.literal("drifted"),
      ),
    ),
    lastSyncedCursor: v.optional(v.number()),
    lastSessionId: v.optional(v.string()),
    rebindCount: v.optional(v.number()),
    lastErrorCode: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
    syncJobId: v.optional(v.string()),
    syncJobState: v.optional(
      v.union(
        v.literal("idle"),
        v.literal("syncing"),
        v.literal("synced"),
        v.literal("failed"),
        v.literal("cancelled"),
      ),
    ),
    syncJobPolicyVersion: v.optional(v.number()),
    syncJobStartedAt: v.optional(v.number()),
    syncJobUpdatedAt: v.optional(v.number()),
    syncJobLastCursor: v.optional(v.number()),
    syncJobErrorCode: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_userId_conversationId", ["userScope", "userId", "conversationId"])
    .index("userScope_userId_runtimeConversationId", ["userScope", "userId", "runtimeConversationId"])
    .index("userScope_userId_threadId", ["userScope", "userId", "threadId"])
    .index("userScope_conversationRef", ["userScope", "conversationRef"]),

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
    threadRef: v.id("codex_threads"),
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
    .index("userScope_threadId_turnId", ["userScope", "threadId", "turnId"])
    .index("userScope_threadRef_startedAt", ["userScope", "threadRef", "startedAt"])
    .index("userScope_threadRef_turnId", ["userScope", "threadRef", "turnId"]),

  codex_items: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.string(),
    turnRef: v.id("codex_turns"),
    itemId: v.string(),
    itemType: v.string(),
    status: v.union(v.literal("inProgress"), v.literal("completed"), v.literal("failed"), v.literal("declined")),
    payloadJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_threadId_turnId_itemId", ["userScope", "threadId", "turnId", "itemId"])
    .index("userScope_threadId_createdAt", ["userScope", "threadId", "createdAt"])
    .index("userScope_turnRef_itemId", ["userScope", "turnRef", "itemId"]),

  codex_event_summaries: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.optional(v.string()),
    turnRef: v.optional(v.id("codex_turns")),
    eventId: v.string(),
    kind: v.string(),
    summary: v.string(),
    createdAt: v.number(),
  })
    .index("userScope_threadId_createdAt", ["userScope", "threadId", "createdAt"])
    .index("userScope_threadRef_createdAt", ["userScope", "threadRef", "createdAt"]),

  codex_messages: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.string(),
    turnRef: v.id("codex_turns"),
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
    .index("userScope_threadId_turnId_status", ["userScope", "threadId", "turnId", "status"])
    .index("userScope_turnRef_orderInTurn", ["userScope", "turnRef", "orderInTurn"]),

  codex_reasoning_segments: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.string(),
    turnRef: v.id("codex_turns"),
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
    .index("userScope_threadId_eventId", ["userScope", "threadId", "eventId"])
    .index("userScope_turnRef_createdAt", ["userScope", "turnRef", "createdAt"]),

  codex_sessions: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
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
    .index("userScope_threadRef", ["userScope", "threadRef"])
    .index("userScope_lastHeartbeatAt", ["userScope", "lastHeartbeatAt"])
    .index("userScope_sessionId", ["userScope", "sessionId"]),

  codex_streams: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.string(),
    turnRef: v.id("codex_turns"),
    streamId: v.string(),
    state: vStreamState,
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    cleanupScheduledAt: v.optional(v.number()),
    cleanupFnId: v.optional(v.id("_scheduled_functions")),
  })
    .index("userScope_threadId_state", ["userScope", "threadId", "state.kind"])
    .index("userScope_threadId_turnId", ["userScope", "threadId", "turnId"])
    .index("userScope_streamId", ["userScope", "streamId"])
    .index("userScope_turnRef_streamId", ["userScope", "turnRef", "streamId"]),

  codex_stream_stats: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    streamId: v.string(),
    streamRef: v.id("codex_streams"),
    state: v.union(v.literal("streaming"), v.literal("finished"), v.literal("aborted")),
    deltaCount: v.number(),
    latestCursor: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_threadId", ["userScope", "threadId"])
    .index("userScope_streamId", ["userScope", "streamId"])
    .index("userScope_streamRef", ["userScope", "streamRef"]),

  codex_stream_deltas_ttl: defineTable({
    userScope: v.string(),
    streamId: v.string(),
    streamRef: v.id("codex_streams"),
    turnId: v.string(),
    turnRef: v.optional(v.id("codex_turns")),
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

  codex_deletion_jobs: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    deletionJobId: v.string(),
    targetKind: v.union(v.literal("thread"), v.literal("turn"), v.literal("actor")),
    threadId: v.optional(v.string()),
    threadRef: v.optional(v.id("codex_threads")),
    turnId: v.optional(v.string()),
    turnRef: v.optional(v.id("codex_turns")),
    status: v.union(
      v.literal("scheduled"),
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    batchSize: v.optional(v.number()),
    scheduledFor: v.optional(v.number()),
    scheduledFnId: v.optional(v.id("_scheduled_functions")),
    reason: v.optional(v.string()),
    phase: v.optional(v.string()),
    deletedCountsJson: v.string(),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
  })
    .index("userScope_deletionJobId", ["userScope", "deletionJobId"])
    .index("userScope_userId_createdAt", ["userScope", "userId", "createdAt"]),

  codex_lifecycle_events: defineTable({
    userScope: v.string(),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.optional(v.string()),
    turnRef: v.optional(v.id("codex_turns")),
    streamRef: v.optional(v.id("codex_streams")),
    eventId: v.string(),
    kind: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  })
    .index("userScope_threadId_createdAt", ["userScope", "threadId", "createdAt"])
    .index("userScope_threadId_turnId_createdAt", ["userScope", "threadId", "turnId", "createdAt"])
    .index("userScope_threadId_eventId", ["userScope", "threadId", "eventId"])
    .index("userScope_threadRef_createdAt", ["userScope", "threadRef", "createdAt"]),

  codex_stream_checkpoints: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    streamId: v.string(),
    streamRef: v.id("codex_streams"),
    ackedCursor: v.number(),
    updatedAt: v.number(),
  })
    .index("userScope_threadId_streamId", ["userScope", "threadId", "streamId"])
    .index("userScope_streamRef", ["userScope", "streamRef"]),

  codex_approvals: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.string(),
    turnRef: v.id("codex_turns"),
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
    .index("userScope_threadId_turnId_itemId", ["userScope", "threadId", "turnId", "itemId"])
    .index("userScope_turnRef_itemId", ["userScope", "turnRef", "itemId"]),

  codex_token_usage: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.string(),
    turnRef: v.id("codex_turns"),
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
    .index("userScope_threadId_updatedAt", ["userScope", "threadId", "updatedAt"])
    .index("userScope_turnRef_updatedAt", ["userScope", "turnRef", "updatedAt"]),

  codex_server_requests: defineTable({
    userScope: v.string(),
    userId: v.optional(v.string()),
    threadId: v.string(),
    threadRef: v.id("codex_threads"),
    turnId: v.string(),
    turnRef: v.id("codex_turns"),
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
    .index("userScope_turnRef_requestIdType_requestIdText", ["userScope", "turnRef", "requestIdType", "requestIdText"])
    .index("userScope_userId_status_updatedAt", ["userScope", "userId", "status", "updatedAt"])
    .index(
      "userScope_userId_threadId_status_updatedAt",
      ["userScope", "userId", "threadId", "status", "updatedAt"],
    ),
});
