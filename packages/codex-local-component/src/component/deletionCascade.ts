/**
 * Cascade deletion batch functions for thread, turn, and actor targets.
 * Extracted from deletionInternal.ts for file-size compliance.
 */
import type { Doc } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { DELETION_QUERY_LIMITS } from "../shared/limits.js";

type DeletionJob = Doc<"codex_deletion_jobs">;
type DeletedCounts = Record<string, number>;

type BatchStep = {
  tableName: string;
  run: (limit: number) => Promise<number>;
};

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
    .take(DELETION_QUERY_LIMITS.threadStreamScan);
  const streamStatRows = await args.ctx.db
    .query("codex_stream_stats")
    .withIndex("userScope_threadId", (q) =>
      q.eq("userScope", args.userScope).eq("threadId", args.threadId),
    )
    .take(DELETION_QUERY_LIMITS.threadStreamScan);
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
    .take(DELETION_QUERY_LIMITS.turnStreamScan);
  const streamStatRows = await args.ctx.db
    .query("codex_stream_stats")
    .withIndex("userScope_threadId", (q) =>
      q.eq("userScope", args.userScope).eq("threadId", args.threadId),
    )
    .filter((q) => q.eq(q.field("turnId"), args.turnId))
    .take(DELETION_QUERY_LIMITS.turnStreamScan);
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

async function runBatchSteps(
  batchSize: number,
  steps: BatchStep[],
): Promise<{ deletedByTable: DeletedCounts; phase?: string }> {
  const deletedByTable: DeletedCounts = {};
  let phase: string | undefined;
  let remaining = batchSize;

  for (const step of steps) {
    if (remaining <= 0) {
      break;
    }
    const deleted = await step.run(remaining);
    if (deleted <= 0) {
      continue;
    }
    deletedByTable[step.tableName] = (deletedByTable[step.tableName] ?? 0) + deleted;
    remaining -= deleted;
    phase = step.tableName;
  }

  return { deletedByTable, ...(phase !== undefined ? { phase } : {}) };
}

function createThreadSteps(args: {
  ctx: MutationCtx;
  job: DeletionJob;
  threadId: string;
}): BatchStep[] {
  return [
    {
      tableName: "codex_stream_deltas_ttl",
      run: (limit) =>
        deleteThreadStreamDeltasBatch({
          ctx: args.ctx,
          userScope: args.job.userScope,
          threadId: args.threadId,
          limit,
        }),
    },
    {
      tableName: "codex_server_requests",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_server_requests")
          .withIndex("userScope_threadId_requestIdType_requestIdText", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_approvals",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_approvals")
          .withIndex("userScope_userId_threadId_status_createdAt_itemId", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("userId", args.job.userId)
              .eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_items",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_items")
          .withIndex("userScope_threadId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_messages",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_messages")
          .withIndex("userScope_threadId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_reasoning_segments",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_reasoning_segments")
          .withIndex("userScope_threadId_createdAt_segmentId", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_token_usage",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_token_usage")
          .withIndex("userScope_threadId_updatedAt", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_event_summaries",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_event_summaries")
          .withIndex("userScope_threadId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_lifecycle_events",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_lifecycle_events")
          .withIndex("userScope_threadId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_stream_checkpoints",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_stream_checkpoints")
          .withIndex("userScope_threadId_streamId", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_sessions",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_sessions")
          .withIndex("userScope_threadId", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_turns",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_turns")
          .withIndex("userScope_threadId_startedAt", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_stream_stats",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_stream_stats")
          .withIndex("userScope_threadId", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_streams",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_streams")
          .withIndex("userScope_threadId_state", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_thread_bindings",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_thread_bindings")
          .withIndex("userScope_userId_threadId", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("userId", args.job.userId)
              .eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_threads",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_threads")
          .withIndex("userScope_threadId", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
  ];
}

function createTurnSteps(args: {
  ctx: MutationCtx;
  job: DeletionJob;
  threadId: string;
  turnId: string;
}): BatchStep[] {
  return [
    {
      tableName: "codex_stream_deltas_ttl",
      run: (limit) =>
        deleteTurnStreamDeltasBatch({
          ctx: args.ctx,
          userScope: args.job.userScope,
          threadId: args.threadId,
          turnId: args.turnId,
          limit,
        }),
    },
    {
      tableName: "codex_server_requests",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_server_requests")
          .withIndex("userScope_threadId_requestIdType_requestIdText", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .filter((q) => q.eq(q.field("turnId"), args.turnId))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_approvals",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_approvals")
          .withIndex("userScope_threadId_turnId_itemId", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_items",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_items")
          .withIndex("userScope_threadId_turnId_itemId", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_messages",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_messages")
          .withIndex("userScope_threadId_turnId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_reasoning_segments",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_reasoning_segments")
          .withIndex("userScope_threadId_turnId_itemId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_token_usage",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_token_usage")
          .withIndex("userScope_threadId_turnId", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_event_summaries",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_event_summaries")
          .withIndex("userScope_threadId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .filter((q) => q.eq(q.field("turnId"), args.turnId))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_lifecycle_events",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_lifecycle_events")
          .withIndex("userScope_threadId_turnId_createdAt", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_turns",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_turns")
          .withIndex("userScope_threadId_turnId", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_stream_stats",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_stream_stats")
          .withIndex("userScope_threadId", (q) =>
            q.eq("userScope", args.job.userScope).eq("threadId", args.threadId),
          )
          .filter((q) => q.eq(q.field("turnId"), args.turnId))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_streams",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_streams")
          .withIndex("userScope_threadId_turnId", (q) =>
            q.eq("userScope", args.job.userScope)
              .eq("threadId", args.threadId)
              .eq("turnId", args.turnId),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
  ];
}

function createActorSteps(args: {
  ctx: MutationCtx;
  job: DeletionJob;
}): BatchStep[] {
  return [
    {
      tableName: "codex_stream_deltas_ttl",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_stream_deltas_ttl")
          .withIndex("userScope_streamId_cursorStart", (q) =>
            q.eq("userScope", args.job.userScope),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_server_requests",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_server_requests")
          .withIndex("userScope_threadId_requestIdType_requestIdText", (q) =>
            q.eq("userScope", args.job.userScope),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_approvals",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_approvals")
          .withIndex("userScope_threadId_status", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_items",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_items")
          .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_messages",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_messages")
          .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_reasoning_segments",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_reasoning_segments")
          .withIndex("userScope_threadId_createdAt_segmentId", (q) =>
            q.eq("userScope", args.job.userScope),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_token_usage",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_token_usage")
          .withIndex("userScope_threadId_updatedAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_event_summaries",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_event_summaries")
          .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_lifecycle_events",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_lifecycle_events")
          .withIndex("userScope_threadId_createdAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_stream_checkpoints",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_stream_checkpoints")
          .withIndex("userScope_threadId_streamId", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_sessions",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_sessions")
          .withIndex("userScope_lastHeartbeatAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_turns",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_turns")
          .withIndex("userScope_threadId_startedAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_stream_stats",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_stream_stats")
          .withIndex("userScope_streamId", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_streams",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_streams")
          .withIndex("userScope_streamId", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_thread_bindings",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_thread_bindings")
          .withIndex("userScope_userId_externalThreadId", (q) =>
            q.eq("userScope", args.job.userScope),
          )
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
    {
      tableName: "codex_threads",
      run: async (limit) => {
        const docs = await args.ctx.db
          .query("codex_threads")
          .withIndex("userScope_updatedAt", (q) => q.eq("userScope", args.job.userScope))
          .take(limit);
        return deleteDocs(args.ctx, docs);
      },
    },
  ];
}

function createTargetSteps(args: {
  ctx: MutationCtx;
  job: DeletionJob;
}): BatchStep[] {
  switch (args.job.targetKind) {
    case "thread": {
      const threadId = args.job.threadId;
      return threadId ? createThreadSteps({ ...args, threadId }) : [];
    }
    case "turn": {
      const threadId = args.job.threadId;
      const turnId = args.job.turnId;
      return threadId && turnId ? createTurnSteps({ ...args, threadId, turnId }) : [];
    }
    case "actor":
      return createActorSteps(args);
    default:
      return [];
  }
}

export async function runBatchForTarget(args: {
  ctx: MutationCtx;
  job: DeletionJob;
  batchSize: number;
}): Promise<{ deletedByTable: DeletedCounts; phase?: string }> {
  return runBatchSteps(args.batchSize, createTargetSteps(args));
}
