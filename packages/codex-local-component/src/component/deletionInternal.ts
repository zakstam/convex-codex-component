import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel.js";
import type { MutationCtx } from "./_generated/server.js";
import { internalMutation } from "./_generated/server.js";
import { now } from "./utils.js";
import { runBatchForTarget } from "./deletionCascade.js";

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
