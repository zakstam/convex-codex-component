import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { internalMutation } from "./_generated/server.js";
import { now } from "./utils.js";

const DELETE_BATCH_DEFAULT = 500;
const DELETE_BATCH_MAX = 2000;

type DeletionJob = Doc<"codex_deletion_jobs">;
type DeletedCounts = Record<string, number>;

function clampBatchSize(batchSize: number | undefined): number {
  return Math.max(1, Math.min(batchSize ?? DELETE_BATCH_DEFAULT, DELETE_BATCH_MAX));
}

function parseDeletedCounts(deletedCountsJson: string): DeletedCounts {
  try {
    const parsed = JSON.parse(deletedCountsJson) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: DeletedCounts = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        result[key] = value;
      }
    }
    return result;
  } catch (error) {
    void error;
    return {};
  }
}

function mergeDeletedCounts(current: DeletedCounts, delta: DeletedCounts): DeletedCounts {
  const merged: DeletedCounts = { ...current };
  for (const [tableName, count] of Object.entries(delta)) {
    merged[tableName] = (merged[tableName] ?? 0) + count;
  }
  return merged;
}

async function loadDeletionJob(args: {
  ctx: MutationCtx;
  userScope: string;
  deletionJobId: string;
}): Promise<DeletionJob | null> {
  return args.ctx.db
    .query("codex_deletion_jobs")
    .withIndex("userScope_deletionJobId", (q) =>
      q.eq("userScope", args.userScope).eq("deletionJobId", args.deletionJobId),
    )
    .first();
}

async function scheduleNextChunk(args: {
  ctx: MutationCtx;
  userScope: string;
  deletionJobId: string;
  batchSize: number;
}): Promise<void> {
  await args.ctx.scheduler.runAfter(
    0,
    makeFunctionReference<"mutation">("deletionInternal:runDeletionJobChunk"),
    {
      userScope: args.userScope,
      deletionJobId: args.deletionJobId,
      batchSize: args.batchSize,
    },
  );
}

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
    if (remaining <= 0) {
      break;
    }
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
    if (remaining <= 0) {
      break;
    }
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
  if (!threadId) {
    return { deletedByTable: {} };
  }

  const deletedByTable: DeletedCounts = {};
  let phase: string | undefined;
  let remaining = args.batchSize;

  const runStep = async (tableName: string, run: (limit: number) => Promise<number>) => {
    if (remaining <= 0) {
      return;
    }
    const deleted = await run(remaining);
    if (deleted > 0) {
      deletedByTable[tableName] = (deletedByTable[tableName] ?? 0) + deleted;
      remaining -= deleted;
      phase = tableName;
    }
  };

  await runStep("codex_stream_deltas_ttl", async (limit) =>
    deleteThreadStreamDeltasBatch({
      ctx: args.ctx,
      userScope: args.job.userScope,
      threadId,
      limit,
    }),
  );
  await runStep("codex_turn_dispatches", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_turn_dispatches")
      .withIndex("userScope_threadId_dispatchId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_server_requests", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_server_requests")
      .withIndex("userScope_threadId_requestIdType_requestIdText", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_approvals", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_approvals")
      .withIndex("userScope_userId_threadId_status_createdAt_itemId", (q) =>
        q
          .eq("userScope", args.job.userScope)
          .eq("userId", args.job.userId)
          .eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_items", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_items")
      .withIndex("userScope_threadId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_messages", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_reasoning_segments", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_reasoning_segments")
      .withIndex("userScope_threadId_createdAt_segmentId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_token_usage", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_token_usage")
      .withIndex("userScope_threadId_updatedAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_event_summaries", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_event_summaries")
      .withIndex("userScope_threadId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_lifecycle_events", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_lifecycle_events")
      .withIndex("userScope_threadId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_checkpoints", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_stream_checkpoints")
      .withIndex("userScope_threadId_streamId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_sessions", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_sessions")
      .withIndex("userScope_threadId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_turns", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_startedAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_stats", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_stream_stats")
      .withIndex("userScope_threadId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_streams", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_streams")
      .withIndex("userScope_threadId_state", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_thread_bindings", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_threadId", (q) =>
        q.eq("userScope", args.job.userScope).eq("userId", args.job.userId).eq("threadId", threadId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_threads", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_threads")
      .withIndex("userScope_threadId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .take(limit);
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
  if (!threadId || !turnId) {
    return { deletedByTable: {} };
  }

  const deletedByTable: DeletedCounts = {};
  let phase: string | undefined;
  let remaining = args.batchSize;

  const runStep = async (tableName: string, run: (limit: number) => Promise<number>) => {
    if (remaining <= 0) {
      return;
    }
    const deleted = await run(remaining);
    if (deleted > 0) {
      deletedByTable[tableName] = (deletedByTable[tableName] ?? 0) + deleted;
      remaining -= deleted;
      phase = tableName;
    }
  };

  await runStep("codex_stream_deltas_ttl", async (limit) =>
    deleteTurnStreamDeltasBatch({
      ctx: args.ctx,
      userScope: args.job.userScope,
      threadId,
      turnId,
      limit,
    }),
  );
  await runStep("codex_turn_dispatches", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_turn_dispatches")
      .withIndex("userScope_threadId_turnId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_server_requests", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_server_requests")
      .withIndex("userScope_threadId_requestIdType_requestIdText", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .filter((q) => q.eq(q.field("turnId"), turnId))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_approvals", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_approvals")
      .withIndex("userScope_threadId_turnId_itemId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_items", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_items")
      .withIndex("userScope_threadId_turnId_itemId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_messages", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_turnId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_reasoning_segments", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_reasoning_segments")
      .withIndex("userScope_threadId_turnId_itemId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_token_usage", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_token_usage")
      .withIndex("userScope_threadId_turnId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_event_summaries", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_event_summaries")
      .withIndex("userScope_threadId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .filter((q) => q.eq(q.field("turnId"), turnId))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_lifecycle_events", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_lifecycle_events")
      .withIndex("userScope_threadId_turnId_createdAt", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_turns", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_turnId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_stats", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_stream_stats")
      .withIndex("userScope_threadId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId),
      )
      .filter((q) => q.eq(q.field("turnId"), turnId))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_streams", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_streams")
      .withIndex("userScope_threadId_turnId", (q) =>
        q.eq("userScope", args.job.userScope).eq("threadId", threadId).eq("turnId", turnId),
      )
      .take(limit);
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
    if (remaining <= 0) {
      return;
    }
    const deleted = await run(remaining);
    if (deleted > 0) {
      deletedByTable[tableName] = (deletedByTable[tableName] ?? 0) + deleted;
      remaining -= deleted;
      phase = tableName;
    }
  };

  await runStep("codex_stream_deltas_ttl", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_stream_deltas_ttl")
      .withIndex("userScope", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_turn_dispatches", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_turn_dispatches")
      .withIndex("userScope_threadId_dispatchId", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_server_requests", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_server_requests")
      .withIndex("userScope_threadId_requestIdType_requestIdText", (q) =>
        q.eq("userScope", args.job.userScope),
      )
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_approvals", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_approvals")
      .withIndex("userScope_threadId_status", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_items", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_items")
      .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_messages", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_messages")
      .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_reasoning_segments", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_reasoning_segments")
      .withIndex("userScope_threadId_createdAt_segmentId", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_token_usage", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_token_usage")
      .withIndex("userScope_threadId_updatedAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_event_summaries", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_event_summaries")
      .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_lifecycle_events", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_lifecycle_events")
      .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_checkpoints", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_stream_checkpoints")
      .withIndex("userScope_threadId_streamId", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_sessions", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_sessions")
      .withIndex("userScope_lastHeartbeatAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_turns", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_turns")
      .withIndex("userScope_threadId_startedAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_stream_stats", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_stream_stats")
      .withIndex("userScope_streamId", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_streams", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_streams")
      .withIndex("userScope_streamId", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_thread_bindings", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_thread_bindings")
      .withIndex("userScope_userId_externalThreadId", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });
  await runStep("codex_threads", async (limit) => {
    const docs = await args.ctx.db
      .query("codex_threads")
      .withIndex("userScope_updatedAt", (q) => q.eq("userScope", args.job.userScope))
      .take(limit);
    return deleteDocs(args.ctx, docs);
  });

  return { deletedByTable, ...(phase !== undefined ? { phase } : {}) };
}

async function runBatchForTarget(args: {
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

export const runDeletionJobChunk = internalMutation({
  args: {
    userScope: v.string(),
    deletionJobId: v.string(),
    batchSize: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let job = await loadDeletionJob({
      ctx,
      userScope: args.userScope,
      deletionJobId: args.deletionJobId,
    });
    if (!job) {
      return null;
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return null;
    }

    const ts = now();
    if (job.status === "scheduled") {
      if (job.scheduledFor !== undefined && Number(job.scheduledFor) > ts) {
        return null;
      }
      await ctx.db.patch(job._id, {
        status: "queued",
        scheduledFnId: undefined,
        scheduledFor: undefined,
        updatedAt: ts,
      });
      const reloaded = await loadDeletionJob({
        ctx,
        userScope: args.userScope,
        deletionJobId: args.deletionJobId,
      });
      if (!reloaded) {
        return null;
      }
      job = reloaded;
    }

    if (job.status === "queued") {
      await ctx.db.patch(job._id, {
        status: "running",
        startedAt: ts,
        updatedAt: ts,
      });
    }

    const batchSize = clampBatchSize(args.batchSize);

    try {
      const batchResult = await runBatchForTarget({
        ctx,
        job,
        batchSize,
      });
      const deltaCounts = batchResult.deletedByTable;
      const totalDeleted = Object.values(deltaCounts).reduce((sum, count) => sum + count, 0);
      const nextCounts = mergeDeletedCounts(parseDeletedCounts(job.deletedCountsJson), deltaCounts);

      if (totalDeleted === 0) {
        await ctx.db.patch(job._id, {
          status: "completed",
          ...(batchResult.phase !== undefined ? { phase: batchResult.phase } : {}),
          deletedCountsJson: JSON.stringify(nextCounts),
          updatedAt: ts,
          completedAt: ts,
        });
        return null;
      }

      await ctx.db.patch(job._id, {
        status: "running",
        ...(batchResult.phase !== undefined ? { phase: batchResult.phase } : {}),
        deletedCountsJson: JSON.stringify(nextCounts),
        updatedAt: ts,
      });

      await scheduleNextChunk({
        ctx,
        userScope: args.userScope,
        deletionJobId: args.deletionJobId,
        batchSize,
      });
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown deletion job failure";
      await ctx.db.patch(job._id, {
        status: "failed",
        errorCode: "E_DELETE_JOB_FAILED",
        errorMessage: message.slice(0, 500),
        updatedAt: now(),
        completedAt: now(),
      });
      return null;
    }
  },
});
