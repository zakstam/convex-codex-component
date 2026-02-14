/**
 * Cascade deletion batch functions for thread, turn, and actor targets.
 * Extracted from deletionInternal.ts for file-size compliance.
 */
import type { Doc } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";

type DeletionJob = Doc<"codex_deletion_jobs">;
type DeletedCounts = Record<string, number>;

async function deleteDocs(
  ctx: MutationCtx,
  docs: Array<{ _id: unknown }>,
): Promise<number> {
  if (docs.length === 0) {
    return 0;
  }
  await Promise.all(docs.map((doc) => ctx.db.delete(doc._id as never)));
  return docs.length;
}

async function deleteThreadStreamDeltasBatch(args: {
  ctx: MutationCtx;
  userScope: string;
  threadId: string;
  limit: number;
}): Promise<number> {
  const streamRows = await args.ctx.db
    .query("codex_streams")
    .withIndex("userScope_threadId_turnId", (q) =>
      q.eq("userScope", args.userScope).eq("threadId", args.threadId),
    )
    .take(1000);
  const streamStatRows = await args.ctx.db
    .query("codex_stream_stats")
    .withIndex("userScope_threadId", (q) =>
      q.eq("userScope", args.userScope).eq("threadId", args.threadId),
    )
    .take(1000);
  const streamIds = new Set<string>([
    ...streamRows.map((row) => String(row.streamId)),
    ...streamStatRows.map((row) => String(row.streamId)),
  ]);

  let remaining = args.limit;
  let deleted = 0;
  for (const streamId of streamIds) {
    if (remaining <= 0) break;
    const batch = await args.ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("userScope_streamId_cursorStart", (q) =>
        q.eq("userScope", args.userScope).eq("streamId", streamId),
      )
      .take(remaining);
    const removed = await deleteDocs(args.ctx, batch);
    deleted += removed;
    remaining -= removed;
  }
  return deleted;
}

async function deleteTurnStreamDeltasBatch(args: {
  ctx: MutationCtx;
  userScope: string;
  threadId: string;
  turnId: string;
  limit: number;
}): Promise<number> {
  const streamRows = await args.ctx.db
    .query("codex_streams")
    .withIndex("userScope_threadId_turnId", (q) =>
      q.eq("userScope", args.userScope).eq("threadId", args.threadId).eq("turnId", args.turnId),
    )
    .take(500);
  const streamStatRows = await args.ctx.db
    .query("codex_stream_stats")
    .withIndex("userScope_threadId", (q) =>
      q.eq("userScope", args.userScope).eq("threadId", args.threadId),
    )
    .filter((q) => q.eq(q.field("turnId"), args.turnId))
    .take(500);
  const streamIds = new Set<string>([
    ...streamRows.map((row) => String(row.streamId)),
    ...streamStatRows.map((row) => String(row.streamId)),
  ]);

  let remaining = args.limit;
  let deleted = 0;
  for (const streamId of streamIds) {
    if (remaining <= 0) break;
    const batch = await args.ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("userScope_streamId_cursorStart", (q) =>
        q.eq("userScope", args.userScope).eq("streamId", streamId),
      )
      .take(remaining);
    const removed = await deleteDocs(args.ctx, batch);
    deleted += removed;
    remaining -= removed;
  }
  return deleted;
}

async function runThreadBatch(args: {
  ctx: MutationCtx;
  job: DeletionJob;
  batchSize: number;
}): Promise<{ deletedByTable: DeletedCounts; phase?: string }> {
  const threadId = args.job.threadId;
  if (!threadId) return { deletedByTable: {} };

  const deletedByTable: DeletedCounts = {};
  let phase: string | undefined;
  let remaining = args.batchSize;

  const runStep = async (tableName: string, run: (limit: number) => Promise<number>) => {
    if (remaining <= 0) return;
    const deleted = await run(remaining);
    if (deleted > 0) { deletedByTable[tableName] = (deletedByTable[tableName] ?? 0) + deleted; remaining -= deleted; phase = tableName; }
  };

  await runStep("codex_stream_deltas_ttl", (limit) => deleteThreadStreamDeltasBatch({ ctx: args.ctx, userScope: args.job.userScope, threadId, limit }));
  await runStep("codex_server_requests", async (limit) => {
    const docs = await args.ctx.db.query("codex_server_requests").withIndex("userScope_threadId_requestIdType_requestIdText", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_approvals", async (limit) => {
    const docs = await args.ctx.db.query("codex_approvals").withIndex("userScope_userId_threadId_status_createdAt_itemId", (q) => q.eq("userScope", args.job.userScope).eq("userId", args.job.userId).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_items", async (limit) => {
    const docs = await args.ctx.db.query("codex_items").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_messages", async (limit) => {
    const docs = await args.ctx.db.query("codex_messages").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_reasoning_segments", async (limit) => {
    const docs = await args.ctx.db.query("codex_reasoning_segments").withIndex("userScope_threadId_createdAt_segmentId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_token_usage", async (limit) => {
    const docs = await args.ctx.db.query("codex_token_usage").withIndex("userScope_threadId_updatedAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_event_summaries", async (limit) => {
    const docs = await args.ctx.db.query("codex_event_summaries").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_lifecycle_events", async (limit) => {
    const docs = await args.ctx.db.query("codex_lifecycle_events").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_checkpoints", async (limit) => {
    const docs = await args.ctx.db.query("codex_stream_checkpoints").withIndex("userScope_threadId_streamId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_sessions", async (limit) => {
    const docs = await args.ctx.db.query("codex_sessions").withIndex("userScope_threadId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_turns", async (limit) => {
    const docs = await args.ctx.db.query("codex_turns").withIndex("userScope_threadId_startedAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_stats", async (limit) => {
    const docs = await args.ctx.db.query("codex_stream_stats").withIndex("userScope_threadId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_streams", async (limit) => {
    const docs = await args.ctx.db.query("codex_streams").withIndex("userScope_threadId_state", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_thread_bindings", async (limit) => {
    const docs = await args.ctx.db.query("codex_thread_bindings").withIndex("userScope_userId_threadId", (q) => q.eq("userScope", args.job.userScope).eq("userId", args.job.userId).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_threads", async (limit) => {
    const docs = await args.ctx.db.query("codex_threads").withIndex("userScope_threadId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });

  return { deletedByTable, ...(phase !== undefined ? { phase } : {}) };
}

async function runTurnBatch(args: {
  ctx: MutationCtx;
  job: DeletionJob;
  batchSize: number;
}): Promise<{ deletedByTable: DeletedCounts; phase?: string }> {
  const threadId = args.job.threadId;
  const turnId = args.job.turnId;
  if (!threadId || !turnId) return { deletedByTable: {} };

  const deletedByTable: DeletedCounts = {};
  let phase: string | undefined;
  let remaining = args.batchSize;

  const runStep = async (tableName: string, run: (limit: number) => Promise<number>) => {
    if (remaining <= 0) return;
    const deleted = await run(remaining);
    if (deleted > 0) { deletedByTable[tableName] = (deletedByTable[tableName] ?? 0) + deleted; remaining -= deleted; phase = tableName; }
  };

  await runStep("codex_stream_deltas_ttl", (limit) => deleteTurnStreamDeltasBatch({ ctx: args.ctx, userScope: args.job.userScope, threadId, turnId, limit }));
  await runStep("codex_server_requests", async (limit) => {
    const docs = await args.ctx.db.query("codex_server_requests").withIndex("userScope_threadId_requestIdType_requestIdText", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).filter((q) => q.eq(q.field("turnId"), turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_approvals", async (limit) => {
    const docs = await args.ctx.db.query("codex_approvals").withIndex("userScope_threadId_turnId_itemId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_items", async (limit) => {
    const docs = await args.ctx.db.query("codex_items").withIndex("userScope_threadId_turnId_itemId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_messages", async (limit) => {
    const docs = await args.ctx.db.query("codex_messages").withIndex("userScope_threadId_turnId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_reasoning_segments", async (limit) => {
    const docs = await args.ctx.db.query("codex_reasoning_segments").withIndex("userScope_threadId_turnId_itemId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_token_usage", async (limit) => {
    const docs = await args.ctx.db.query("codex_token_usage").withIndex("userScope_threadId_turnId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_event_summaries", async (limit) => {
    const docs = await args.ctx.db.query("codex_event_summaries").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).filter((q) => q.eq(q.field("turnId"), turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_lifecycle_events", async (limit) => {
    const docs = await args.ctx.db.query("codex_lifecycle_events").withIndex("userScope_threadId_turnId_createdAt", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_turns", async (limit) => {
    const docs = await args.ctx.db.query("codex_turns").withIndex("userScope_threadId_turnId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_stats", async (limit) => {
    const docs = await args.ctx.db.query("codex_stream_stats").withIndex("userScope_threadId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId)).filter((q) => q.eq(q.field("turnId"), turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_streams", async (limit) => {
    const docs = await args.ctx.db.query("codex_streams").withIndex("userScope_threadId_turnId", (q) => q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId)).take(limit);
    return deleteDocs(args.ctx, docs);
  });

  return { deletedByTable, ...(phase !== undefined ? { phase } : {}) };
}

async function runActorBatch(args: {
  ctx: MutationCtx;
  job: DeletionJob;
  batchSize: number;
}): Promise<{ deletedByTable: DeletedCounts; phase?: string }> {
  const deletedByTable: DeletedCounts = {};
  let phase: string | undefined;
  let remaining = args.batchSize;

  const runStep = async (tableName: string, run: (limit: number) => Promise<number>) => {
    if (remaining <= 0) return;
    const deleted = await run(remaining);
    if (deleted > 0) { deletedByTable[tableName] = (deletedByTable[tableName] ?? 0) + deleted; remaining -= deleted; phase = tableName; }
  };

  await runStep("codex_stream_deltas_ttl", async (limit) => {
    const docs = await args.ctx.db.query("codex_stream_deltas_ttl").withIndex("userScope_streamId_cursorStart", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_server_requests", async (limit) => {
    const docs = await args.ctx.db.query("codex_server_requests").withIndex("userScope_threadId_requestIdType_requestIdText", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_approvals", async (limit) => {
    const docs = await args.ctx.db.query("codex_approvals").withIndex("userScope_threadId_status", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_items", async (limit) => {
    const docs = await args.ctx.db.query("codex_items").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_messages", async (limit) => {
    const docs = await args.ctx.db.query("codex_messages").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_reasoning_segments", async (limit) => {
    const docs = await args.ctx.db.query("codex_reasoning_segments").withIndex("userScope_threadId_createdAt_segmentId", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_token_usage", async (limit) => {
    const docs = await args.ctx.db.query("codex_token_usage").withIndex("userScope_threadId_updatedAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_event_summaries", async (limit) => {
    const docs = await args.ctx.db.query("codex_event_summaries").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_lifecycle_events", async (limit) => {
    const docs = await args.ctx.db.query("codex_lifecycle_events").withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_checkpoints", async (limit) => {
    const docs = await args.ctx.db.query("codex_stream_checkpoints").withIndex("userScope_threadId_streamId", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_sessions", async (limit) => {
    const docs = await args.ctx.db.query("codex_sessions").withIndex("userScope_lastHeartbeatAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_turns", async (limit) => {
    const docs = await args.ctx.db.query("codex_turns").withIndex("userScope_threadId_startedAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_stats", async (limit) => {
    const docs = await args.ctx.db.query("codex_stream_stats").withIndex("userScope_streamId", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_streams", async (limit) => {
    const docs = await args.ctx.db.query("codex_streams").withIndex("userScope_streamId", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_thread_bindings", async (limit) => {
    const docs = await args.ctx.db.query("codex_thread_bindings").withIndex("userScope_userId_externalThreadId", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_threads", async (limit) => {
    const docs = await args.ctx.db.query("codex_threads").withIndex("userScope_updatedAt", (q) => q.eq("userScope", args.job.userScope)).take(limit);
    return deleteDocs(args.ctx, docs);
  });

  return { deletedByTable, ...(phase !== undefined ? { phase } : {}) };
}

export async function runBatchForTarget(args: {
  ctx: MutationCtx;
  job: DeletionJob;
  batchSize: number;
}): Promise<{ deletedByTable: DeletedCounts; phase?: string }> {
  switch (args.job.targetKind) {
    case "thread":
      return runThreadBatch(args);
    case "turn":
      return runTurnBatch(args);
    case "actor":
      return runActorBatch(args);
    default:
      return { deletedByTable: {} };
  }
}
