/**
 * Convex validators for thread-related query/mutation return types.
 * Extracted from threads.ts for file-size compliance per ADR-20260214.
 */
import { v } from "convex/values";

export const vThreadState = v.object({
  threadId: v.string(),
  threadStatus: v.string(),
  turns: v.array(
    v.object({
      turnId: v.string(),
      status: v.string(),
      startedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  activeStreams: v.array(
    v.object({
      streamId: v.string(),
      turnId: v.string(),
      state: v.string(),
      startedAt: v.number(),
    }),
  ),
  allStreams: v.array(
    v.object({
      streamId: v.string(),
      turnId: v.string(),
      state: v.string(),
      startedAt: v.number(),
    }),
  ),
  streamStats: v.array(
    v.object({
      streamId: v.string(),
      state: v.union(v.literal("streaming"), v.literal("finished"), v.literal("aborted")),
      deltaCount: v.number(),
      latestCursor: v.number(),
    }),
  ),
  pendingApprovals: v.array(
    v.object({
      turnId: v.string(),
      itemId: v.string(),
      kind: v.string(),
      reason: v.optional(v.string()),
    }),
  ),
  recentMessages: v.array(
    v.object({
      messageId: v.string(),
      turnId: v.string(),
      role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system"), v.literal("tool")),
      status: v.union(v.literal("streaming"), v.literal("completed"), v.literal("failed"), v.literal("interrupted")),
      text: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
      completedAt: v.optional(v.number()),
    }),
  ),
  lifecycleMarkers: v.array(
    v.object({
      kind: v.string(),
      turnId: v.optional(v.string()),
      streamId: v.optional(v.string()),
      createdAt: v.number(),
    }),
  ),
});

export const vDeletionJobStatus = v.object({
  deletionJobId: v.string(),
  status: v.union(
    v.literal("scheduled"),
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  targetKind: v.union(v.literal("thread"), v.literal("turn"), v.literal("actor")),
  threadId: v.optional(v.string()),
  turnId: v.optional(v.string()),
  batchSize: v.optional(v.number()),
  scheduledFor: v.optional(v.number()),
  reason: v.optional(v.string()),
  phase: v.optional(v.string()),
  deletedCountsByTable: v.array(
    v.object({
      tableName: v.string(),
      deleted: v.number(),
    }),
  ),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  cancelledAt: v.optional(v.number()),
  updatedAt: v.number(),
});
