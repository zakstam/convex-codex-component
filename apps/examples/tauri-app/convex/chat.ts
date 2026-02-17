import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { components } from "./_generated/api";
import {
  createCodexConvexHost,
  vHostActorContext,
} from "@zakstam/codex-local-component/host/convex";
import { v } from "convex/values";
import {
  SERVER_ACTOR,
  requireBoundServerActorForMutation,
  requireBoundServerActorForQuery,
} from "./actorLock";
export { getActorBindingForBootstrap, listThreadsForPicker } from "./chat.extensions";

const codexHost = createCodexConvexHost({
  components,
  actorPolicy: {
    mode: "guarded",
    serverActor: SERVER_ACTOR,
    resolveMutationActor: requireBoundServerActorForMutation,
    resolveQueryActor: requireBoundServerActorForQuery,
  },
});
const hostDefs = codexHost.defs;

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

async function runMutationWithBoundActor(
  ctx: MutationCtx,
  actor: { userId?: string },
  mutationRef: Parameters<MutationCtx["runMutation"]>[0],
  args: Record<string, unknown>,
) {
  const serverActor = await requireBoundServerActorForMutation(ctx, actor);
  return ctx.runMutation(mutationRef, {
    actor: serverActor,
    ...args,
  });
}

async function runQueryWithBoundActor(
  ctx: QueryCtx,
  actor: { userId?: string },
  queryRef: Parameters<QueryCtx["runQuery"]>[0],
  args: Record<string, unknown>,
) {
  const serverActor = await requireBoundServerActorForQuery(ctx, actor);
  return ctx.runQuery(queryRef, {
    actor: serverActor,
    ...args,
  });
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

export const ensureSession = mutation(hostDefs.mutations.ensureSession);
export const ingestEvent = mutation(hostDefs.mutations.ingestEvent);
export const ingestBatch = mutation(hostDefs.mutations.ingestBatch);
export const respondApproval = mutation(hostDefs.mutations.respondApprovalForHooks);
export const upsertTokenUsage = mutation(hostDefs.mutations.upsertTokenUsageForHooks);

export const upsertPendingServerRequest = mutation({
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
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.serverRequests.upsertPending, {
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

export const resolvePendingServerRequest = mutation({
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
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.serverRequests.resolve, {
      threadId: args.threadId,
      requestId: args.requestId,
      status: args.status,
      resolvedAt: args.resolvedAt,
      ...(args.responseJson ? { responseJson: args.responseJson } : {}),
    });
  },
});

export const listPendingServerRequests = query({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    return runQueryWithBoundActor(ctx, args.actor, components.codexLocal.serverRequests.listPending, {
      ...(args.threadId ? { threadId: args.threadId } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
  },
});

export const interruptTurn = mutation(hostDefs.mutations.interruptTurnForHooks);

export const acceptTurnSend = mutation({
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
    await runMutationWithBoundActor(ctx, args.actor, components.codexLocal.turns.start, {
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

export const failAcceptedTurnSend = mutation({
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
    await runMutationWithBoundActor(ctx, args.actor, components.codexLocal.turns.interrupt, {
      threadId: args.threadId,
      turnId: args.turnId,
      reason: args.code ? `[${args.code}] ${args.reason}` : args.reason,
    });
    return null;
  },
});

export const deleteThreadCascade = mutation({
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
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.threads.deleteCascade, {
      threadId: args.threadId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
    });
  },
});

export const scheduleThreadDeleteCascade = mutation({
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
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.threads.scheduleDeleteCascade, {
      threadId: args.threadId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
    });
  },
});

export const deleteTurnCascade = mutation({
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
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.turns.deleteCascade, {
      threadId: args.threadId,
      turnId: args.turnId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
    });
  },
});

export const scheduleTurnDeleteCascade = mutation({
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
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.turns.scheduleDeleteCascade, {
      threadId: args.threadId,
      turnId: args.turnId,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
    });
  },
});

export const purgeActorData = mutation({
  args: {
    actor: vHostActorContext,
    reason: v.optional(v.string()),
    batchSize: v.optional(v.number()),
  },
  returns: v.object({
    deletionJobId: v.string(),
  }),
  handler: async (ctx, args) => {
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.threads.purgeActorData, {
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
    });
  },
});

export const schedulePurgeActorData = mutation({
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
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.threads.schedulePurgeActorData, {
      ...(args.reason ? { reason: args.reason } : {}),
      ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
      ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
    });
  },
});

export const cancelScheduledDeletion = mutation({
  args: {
    actor: vHostActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    cancelled: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.threads.cancelScheduledDeletion, {
      deletionJobId: args.deletionJobId,
    });
  },
});

export const forceRunScheduledDeletion = mutation({
  args: {
    actor: vHostActorContext,
    deletionJobId: v.string(),
  },
  returns: v.object({
    deletionJobId: v.string(),
    forced: v.boolean(),
  }),
  handler: async (ctx, args) => {
    return runMutationWithBoundActor(ctx, args.actor, components.codexLocal.threads.forceRunScheduledDeletion, {
      deletionJobId: args.deletionJobId,
    });
  },
});

export const validateHostWiring = query(hostDefs.queries.validateHostWiring);
export const threadSnapshot = query(hostDefs.queries.threadSnapshot);
export const threadSnapshotSafe = query(hostDefs.queries.threadSnapshotSafe);
export const persistenceStats = query(hostDefs.queries.persistenceStats);
export const durableHistoryStats = query(hostDefs.queries.durableHistoryStats);
export const listThreadMessages = query(hostDefs.queries.listThreadMessagesForHooks);
export const listTurnMessages = query(hostDefs.queries.listTurnMessagesForHooks);
export const listPendingApprovals = query(hostDefs.queries.listPendingApprovalsForHooks);
export const listTokenUsage = query(hostDefs.queries.listTokenUsageForHooks);

export const getDeletionJobStatus = query({
  args: {
    actor: vHostActorContext,
    deletionJobId: v.string(),
  },
  handler: async (ctx, args) => {
    return runQueryWithBoundActor(ctx, args.actor, components.codexLocal.threads.getDeletionJobStatus, {
      deletionJobId: args.deletionJobId,
    });
  },
});
