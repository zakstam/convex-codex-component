import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  defineRuntimeOwnedHostEndpoints,
  vHostActorContext,
} from "@zakstam/codex-local-component/host/convex";
import { v } from "convex/values";
import {
  SERVER_ACTOR,
  requireBoundServerActorForMutation,
  requireBoundServerActorForQuery,
} from "./actorLock";
export { getActorBindingForBootstrap, listThreadsForPicker } from "./chat.extensions";

const defs = defineRuntimeOwnedHostEndpoints({
  components,
  serverActor: SERVER_ACTOR,
});

export const ensureThread = mutation({
  ...defs.mutations.ensureThread,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.ensureThread.handler(ctx, args);
  },
});

export const ensureSession = mutation({
  ...defs.mutations.ensureSession,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.ensureSession.handler(ctx, args);
  },
});

export const ingestEvent = mutation({
  ...defs.mutations.ingestEvent,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.ingestEvent.handler(ctx, args);
  },
});

export const ingestBatch = mutation({
  ...defs.mutations.ingestBatch,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.ingestBatch.handler(ctx, args);
  },
});

export const respondApprovalForHooks = mutation({
  ...defs.mutations.respondApprovalForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.respondApprovalForHooks.handler(ctx, args);
  },
});

export const upsertTokenUsageForHooks = mutation({
  ...defs.mutations.upsertTokenUsageForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.upsertTokenUsageForHooks.handler(ctx, args);
  },
});

export const upsertPendingServerRequestForHooks = mutation({
  args: {
    actor: vHostActorContext,
    requestId: v.union(v.string(), v.number()),
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    method: v.union(
      v.literal("item/commandExecution/requestApproval"),
      v.literal("item/fileChange/requestApproval"),
      v.literal("item/tool/requestUserInput"),
      v.literal("item/tool/call"),
    ),
    payloadJson: v.string(),
    reason: v.optional(v.string()),
    questionsJson: v.optional(v.string()),
    requestedAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.serverRequests.upsertPending, {
      actor: SERVER_ACTOR,
      requestId: args.requestId,
      threadId: args.threadId,
      turnId: args.turnId,
      itemId: args.itemId,
      method: args.method,
      payloadJson: args.payloadJson,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.questionsJson ? { questionsJson: args.questionsJson } : {}),
      requestedAt: args.requestedAt ?? Date.now(),
    });
  },
});

export const resolvePendingServerRequestForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    requestId: v.union(v.string(), v.number()),
    status: v.union(v.literal("answered"), v.literal("expired")),
    resolvedAt: v.number(),
    responseJson: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.serverRequests.resolve, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      requestId: args.requestId,
      status: args.status,
      resolvedAt: args.resolvedAt,
      ...(args.responseJson ? { responseJson: args.responseJson } : {}),
    });
  },
});

export const listPendingServerRequestsForHooks = query({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return ctx.runQuery(components.codexLocal.serverRequests.listPending, {
      actor: SERVER_ACTOR,
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
  },
});

export const interruptTurnForHooks = mutation({
  ...defs.mutations.interruptTurnForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.interruptTurnForHooks.handler(ctx, args);
  },
});

export const acceptTurnSendForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    idempotencyKey: v.string(),
    inputText: v.string(),
    dispatchId: v.optional(v.string()),
  },
  returns: v.object({
    dispatchId: v.string(),
    turnId: v.string(),
    accepted: v.literal(true),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    await ctx.runMutation(components.codexLocal.turns.start, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      turnId: args.turnId,
      idempotencyKey: args.idempotencyKey,
      input: [{ type: "text", text: args.inputText }],
    });
    return {
      dispatchId: args.dispatchId ?? args.turnId,
      turnId: args.turnId,
      accepted: true as const,
    } as const;
  },
});

export const failAcceptedTurnSendForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    dispatchId: v.optional(v.string()),
    code: v.optional(v.string()),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    await ctx.runMutation(components.codexLocal.turns.interrupt, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      turnId: args.turnId,
      reason: args.code ? `[${args.code}] ${args.reason}` : args.reason,
    });
    return null;
  },
});

export const deleteThreadCascadeForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.deleteCascade, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
    });
  },
});

export const scheduleThreadDeleteCascadeForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.scheduleDeleteCascade, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
    });
  },
});

export const deleteTurnCascadeForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.turns.deleteCascade, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      turnId: args.turnId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
    });
  },
});

export const scheduleTurnDeleteCascadeForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.turns.scheduleDeleteCascade, {
      actor: SERVER_ACTOR,
      threadId: args.threadId,
      turnId: args.turnId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
    });
  },
});

export const purgeActorDataForHooks = mutation({
  args: {
    actor: vHostActorContext,
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.purgeActorData, {
      actor: SERVER_ACTOR,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
    });
  },
});

export const schedulePurgeActorDataForHooks = mutation({
  args: {
    actor: vHostActorContext,
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    delayMs: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
    scheduledFor: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.schedulePurgeActorData, {
      actor: SERVER_ACTOR,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
    });
  },
});

export const cancelScheduledDeletionForHooks = mutation({
  args: {
    actor: vHostActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    cancelled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.cancelScheduledDeletion, {
      actor: SERVER_ACTOR,
      deletionJobId: args.deletionJobId,
    });
  },
});

export const forceRunScheduledDeletionForHooks = mutation({
  args: {
    actor: vHostActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    forced: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.forceRunScheduledDeletion, {
      actor: SERVER_ACTOR,
      deletionJobId: args.deletionJobId,
    });
  },
});

export const validateHostWiring = query({
  ...defs.queries.validateHostWiring,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.validateHostWiring.handler(ctx, args);
  },
});

export const threadSnapshot = query({
  ...defs.queries.threadSnapshot,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.threadSnapshot.handler(ctx, args);
  },
});

export const threadSnapshotSafe = query({
  ...defs.queries.threadSnapshotSafe,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.threadSnapshotSafe.handler(ctx, args);
  },
});

export const persistenceStats = query({
  ...defs.queries.persistenceStats,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.persistenceStats.handler(ctx, args);
  },
});

export const durableHistoryStats = query({
  ...defs.queries.durableHistoryStats,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.durableHistoryStats.handler(ctx, args);
  },
});

export const listThreadMessagesForHooks = query({
  ...defs.queries.listThreadMessagesForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listThreadMessagesForHooks.handler(ctx, args);
  },
});

export const listTurnMessagesForHooks = query({
  ...defs.queries.listTurnMessagesForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listTurnMessagesForHooks.handler(ctx, args);
  },
});

export const listPendingApprovalsForHooks = query({
  ...defs.queries.listPendingApprovalsForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listPendingApprovalsForHooks.handler(ctx, args);
  },
});

export const listTokenUsageForHooks = query({
  ...defs.queries.listTokenUsageForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listTokenUsageForHooks.handler(ctx, args);
  },
});

export const getDeletionJobStatusForHooks = query({
  args: {
    actor: vHostActorContext,
    deletionJobId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return ctx.runQuery(components.codexLocal.threads.getDeletionJobStatus, {
      actor: SERVER_ACTOR,
      deletionJobId: args.deletionJobId,
    });
  },
});
