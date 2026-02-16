import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
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

const vThreadHandle = v.object({
  threadId: v.string(),
  status: v.union(v.literal("active"), v.literal("archived"), v.literal("failed")),
  updatedAt: v.number(),
  externalThreadId: v.optional(v.string()),
  runtimeThreadId: v.optional(v.string()),
  linkState: v.union(v.literal("linked"), v.literal("runtime_only"), v.literal("persisted_only")),
});

function resolveUserScope(actor: { userId?: string }): string {
  return actor.userId?.trim() ? actor.userId.trim() : "__anonymous__";
}

async function loadThreadHandleByThreadId(
  ctx: MutationCtx | QueryCtx,
  serverActor: { userId?: string },
  threadId: string,
) {
  const threadRecord = await ctx.db
    .query("codex_threads")
    .filter((q) =>
      q.and(
        q.eq(q.field("userScope"), resolveUserScope(serverActor)),
        q.eq(q.field("threadId"), threadId),
      ),
    )
    .first();
  if (!threadRecord) {
    return null;
  }
  const mapping = await ctx.runQuery(components.codexLocal.threads.getExternalMapping, {
    actor: serverActor,
    threadId,
  });
  const externalThreadId = mapping?.externalThreadId;
  const runtimeThreadId = externalThreadId ?? threadRecord.localThreadId;
  return {
    threadId,
    status: String(threadRecord.status) as "active" | "archived" | "failed",
    updatedAt: Number(threadRecord.updatedAt),
    ...(externalThreadId ? { externalThreadId } : {}),
    ...(runtimeThreadId ? { runtimeThreadId } : {}),
    linkState: externalThreadId ? ("linked" as const) : ("persisted_only" as const),
  };
}

async function doEnsureThread(
  ctx: MutationCtx,
  args: {
    actor: { userId?: string };
    threadId?: string;
    externalThreadId?: string;
    model?: string;
    cwd?: string;
  },
) {
  const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
  const localThreadId = args.threadId ?? args.externalThreadId;
  if (!localThreadId) {
    throw new Error("ensureThread requires threadId or externalThreadId.");
  }
  const externalThreadId = args.externalThreadId ?? args.threadId ?? localThreadId;
  const ensured = await ctx.runMutation(components.codexLocal.threads.resolve, {
    actor: serverActor,
    localThreadId,
    externalThreadId,
    ...(args.model ? { model: args.model } : {}),
    ...(args.cwd ? { cwd: args.cwd } : {}),
  });
  return { ensured, serverActor };
}

async function doStartThread(
  ctx: MutationCtx,
  args: {
    actor: { userId?: string };
    threadId?: string;
    externalThreadId?: string;
    model?: string;
    cwd?: string;
  },
) {
  const { ensured, serverActor } = await doEnsureThread(ctx, args);
  const handle = await loadThreadHandleByThreadId(ctx, serverActor, ensured.threadId);
  if (!handle) {
    throw new Error(`Unable to load thread handle for threadId=${ensured.threadId}`);
  }
  return handle;
}

export const ensureThread = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  returns: v.object({
    threadId: v.string(),
    externalThreadId: v.optional(v.string()),
    created: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const { ensured } = await doEnsureThread(ctx, args);
    return ensured;
  },
});

export const startThread = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  returns: vThreadHandle,
  handler: async (ctx, args) => {
    return doStartThread(ctx, args);
  },
});

export const resolveThreadByExternalId = mutation({
  args: {
    actor: vHostActorContext,
    externalThreadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  returns: vThreadHandle,
  handler: async (ctx, args) => {
    const handle = await doStartThread(ctx, {
      actor: args.actor,
      threadId: args.externalThreadId,
      externalThreadId: args.externalThreadId,
      ...(args.model ? { model: args.model } : {}),
      ...(args.cwd ? { cwd: args.cwd } : {}),
    });
    return handle;
  },
});

export const bindRuntimeThreadId = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    runtimeThreadId: v.string(),
  },
  returns: vThreadHandle,
  handler: async (ctx, args) => {
    const handle = await doStartThread(ctx, {
      actor: args.actor,
      threadId: args.threadId,
      externalThreadId: args.runtimeThreadId,
    });
    return handle;
  },
});

export const resolveThreadByRuntimeId = query({
  args: {
    actor: vHostActorContext,
    runtimeThreadId: v.string(),
  },
  returns: v.union(v.null(), vThreadHandle),
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    const mapping = await ctx.runQuery(components.codexLocal.threads.resolveByExternalId, {
      actor: serverActor,
      externalThreadId: args.runtimeThreadId,
    });
    if (!mapping) {
      return null;
    }
    return loadThreadHandleByThreadId(ctx, serverActor, mapping.threadId);
  },
});

export const lookupThreadHandle = query({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    externalThreadId: v.optional(v.string()),
    runtimeThreadId: v.optional(v.string()),
  },
  returns: v.union(v.null(), vThreadHandle),
  handler: async (ctx, args) => {
    const identities = [args.threadId, args.externalThreadId, args.runtimeThreadId].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (identities.length !== 1) {
      throw new Error("lookupThreadHandle requires exactly one identity: threadId, externalThreadId, or runtimeThreadId.");
    }
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    if (args.threadId) {
      return loadThreadHandleByThreadId(ctx, serverActor, args.threadId);
    }
    const mapped = await ctx.runQuery(components.codexLocal.threads.resolveByExternalId, {
      actor: serverActor,
      externalThreadId: args.externalThreadId ?? args.runtimeThreadId!,
    });
    if (!mapped) {
      return null;
    }
    return loadThreadHandleByThreadId(ctx, serverActor, mapped.threadId);
  },
});

export const resumeThread = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: v.union(v.null(), vThreadHandle),
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return loadThreadHandleByThreadId(ctx, serverActor, args.threadId);
  },
});

export const ensureSession = mutation({
  ...defs.mutations.ensureSession,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.ensureSession.handler(ctx, { ...args, actor: serverActor });
  },
});

export const ingestEvent = mutation({
  ...defs.mutations.ingestEvent,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.ingestEvent.handler(ctx, { ...args, actor: serverActor });
  },
});

export const ingestBatch = mutation({
  ...defs.mutations.ingestBatch,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.ingestBatch.handler(ctx, { ...args, actor: serverActor });
  },
});

export const respondApprovalForHooks = mutation({
  ...defs.mutations.respondApprovalForHooks,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.respondApprovalForHooks.handler(ctx, { ...args, actor: serverActor });
  },
});

export const upsertTokenUsageForHooks = mutation({
  ...defs.mutations.upsertTokenUsageForHooks,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.upsertTokenUsageForHooks.handler(ctx, { ...args, actor: serverActor });
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.serverRequests.upsertPending, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.serverRequests.resolve, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return ctx.runQuery(components.codexLocal.serverRequests.listPending, {
      actor: serverActor,
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
  },
});

export const interruptTurnForHooks = mutation({
  ...defs.mutations.interruptTurnForHooks,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.interruptTurnForHooks.handler(ctx, { ...args, actor: serverActor });
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    await ctx.runMutation(components.codexLocal.turns.start, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    await ctx.runMutation(components.codexLocal.turns.interrupt, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.deleteCascade, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.scheduleDeleteCascade, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.turns.deleteCascade, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.turns.scheduleDeleteCascade, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.purgeActorData, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.schedulePurgeActorData, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.cancelScheduledDeletion, {
      actor: serverActor,
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
    const serverActor = await requireBoundServerActorForMutation(ctx, args.actor);
    return ctx.runMutation(components.codexLocal.threads.forceRunScheduledDeletion, {
      actor: serverActor,
      deletionJobId: args.deletionJobId,
    });
  },
});

export const validateHostWiring = query({
  ...defs.queries.validateHostWiring,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.validateHostWiring.handler(ctx, { ...args, actor: serverActor });
  },
});

export const threadSnapshot = query({
  ...defs.queries.threadSnapshot,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.threadSnapshot.handler(ctx, { ...args, actor: serverActor });
  },
});

export const threadSnapshotSafe = query({
  ...defs.queries.threadSnapshotSafe,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.threadSnapshotSafe.handler(ctx, { ...args, actor: serverActor });
  },
});

export const persistenceStats = query({
  ...defs.queries.persistenceStats,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.persistenceStats.handler(ctx, { ...args, actor: serverActor });
  },
});

export const durableHistoryStats = query({
  ...defs.queries.durableHistoryStats,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.durableHistoryStats.handler(ctx, { ...args, actor: serverActor });
  },
});

export const listThreadMessagesForHooks = query({
  ...defs.queries.listThreadMessagesForHooks,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listThreadMessagesForHooks.handler(ctx, { ...args, actor: serverActor });
  },
});

export const listTurnMessagesForHooks = query({
  ...defs.queries.listTurnMessagesForHooks,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listTurnMessagesForHooks.handler(ctx, { ...args, actor: serverActor });
  },
});

export const listPendingApprovalsForHooks = query({
  ...defs.queries.listPendingApprovalsForHooks,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listPendingApprovalsForHooks.handler(ctx, { ...args, actor: serverActor });
  },
});

export const listTokenUsageForHooks = query({
  ...defs.queries.listTokenUsageForHooks,
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listTokenUsageForHooks.handler(ctx, { ...args, actor: serverActor });
  },
});

export const getDeletionJobStatusForHooks = query({
  args: {
    actor: vHostActorContext,
    deletionJobId: v.string(),
  },
  handler: async (ctx, args) => {
    const serverActor = await requireBoundServerActorForQuery(ctx, args.actor);
    return ctx.runQuery(components.codexLocal.threads.getDeletionJobStatus, {
      actor: serverActor,
      deletionJobId: args.deletionJobId,
    });
  },
});
