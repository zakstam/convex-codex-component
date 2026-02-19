import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { components } from "./_generated/api";
import {
  createCodexHost,
  vHostActorContext,
} from "@zakstam/codex-local-component/host/convex";
import { v } from "convex/values";
import {
  SERVER_ACTOR,
  requireBoundServerActorForMutation,
  requireBoundServerActorForQuery,
} from "./actorLock";
export { getActorBindingForBootstrap, listThreadsForPicker } from "./chat.extensions";

const codex = createCodexHost({
  components,
  mutation,
  query,
  actorPolicy: {
    mode: "serverActor",
    serverActor: SERVER_ACTOR,
  },
});

const vThreadHandle = v.object({
  threadId: v.string(),
  status: v.union(v.literal("active"), v.literal("archived"), v.literal("failed")),
  updatedAt: v.number(),
  externalThreadId: v.optional(v.string()),
  runtimeThreadId: v.optional(v.string()),
  linkState: v.union(v.literal("linked"), v.literal("runtime_only"), v.literal("persisted_only")),
});

type ThreadSummary = {
  threadId: string;
  status: "active" | "archived" | "failed";
  updatedAt: number;
};

async function loadThreadSummaryByThreadId(
  ctx: MutationCtx | QueryCtx,
  serverActor: { userId?: string },
  threadId: string,
): Promise<ThreadSummary | null> {
  let cursor: string | null = null;
  while (true) {
    const listed = await ctx.runQuery(components.codexLocal.threads.list, {
      actor: serverActor,
      paginationOpts: {
        numItems: 100,
        cursor,
      },
    }) as {
      page: ThreadSummary[];
      isDone: boolean;
      continueCursor: string;
    };
    const match = listed.page.find((thread: ThreadSummary) => thread.threadId === threadId);
    if (match) {
      return match;
    }
    if (listed.isDone) {
      return null;
    }
    cursor = listed.continueCursor;
  }
}

async function loadThreadHandleByThreadId(
  ctx: MutationCtx | QueryCtx,
  serverActor: { userId?: string },
  threadId: string,
) {
  const threadSummary = await loadThreadSummaryByThreadId(ctx, serverActor, threadId);
  if (!threadSummary) {
    return null;
  }

  const mapping = await ctx.runQuery(components.codexLocal.threads.getExternalMapping, {
    actor: serverActor,
    threadId,
  });
  const externalThreadId = mapping?.externalThreadId;
  const runtimeThreadId = externalThreadId ?? threadId;
  return {
    threadId,
    status: threadSummary.status,
    updatedAt: threadSummary.updatedAt,
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

type ActorBoundArgs = {
  actor: { userId?: string };
};

type HostDefinitionWithActor = {
  args?: unknown;
  returns?: unknown;
  handler: (...args: any[]) => unknown;
};

type DefinitionContext<Definition extends HostDefinitionWithActor> =
  Parameters<Definition["handler"]>[0];

type DefinitionArgs<Definition extends HostDefinitionWithActor> =
  Parameters<Definition["handler"]>[1] & ActorBoundArgs;

type DefinitionResult<Definition extends HostDefinitionWithActor> =
  ReturnType<Definition["handler"]>;

function withBoundMutationActor<Definition extends HostDefinitionWithActor>(
  definition: Definition,
): Definition {
  const wrappedHandler = async (
    ctx: DefinitionContext<Definition>,
    args: DefinitionArgs<Definition>,
  ): Promise<Awaited<DefinitionResult<Definition>>> => {
    const actor = await requireBoundServerActorForMutation(
      ctx as MutationCtx,
      args.actor,
    );
    const nextArgs = {
      ...args,
      actor,
    } as DefinitionArgs<Definition>;
    const result = definition.handler(ctx, nextArgs);
    return result as Awaited<DefinitionResult<Definition>>;
  };

  return {
    ...definition,
    handler: wrappedHandler as Definition["handler"],
  };
}

function withBoundQueryActor<Definition extends HostDefinitionWithActor>(
  definition: Definition,
): Definition {
  const wrappedHandler = async (
    ctx: DefinitionContext<Definition>,
    args: DefinitionArgs<Definition>,
  ): Promise<Awaited<DefinitionResult<Definition>>> => {
    const actor = await requireBoundServerActorForQuery(
      ctx as QueryCtx,
      args.actor,
    );
    const nextArgs = {
      ...args,
      actor,
    } as DefinitionArgs<Definition>;
    const result = definition.handler(ctx, nextArgs);
    return result as Awaited<DefinitionResult<Definition>>;
  };

  return {
    ...definition,
    handler: wrappedHandler as Definition["handler"],
  };
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

export const ensureSession = mutation(
  withBoundMutationActor(codex.defs.mutations.ensureSession),
);
export const ingestEvent = mutation(
  withBoundMutationActor(codex.defs.mutations.ingestEvent),
);
export const ingestBatch = mutation(
  withBoundMutationActor(codex.defs.mutations.ingestBatch),
);
export const respondApproval = mutation(
  withBoundMutationActor(codex.defs.mutations.respondApproval),
);
export const upsertTokenUsage = mutation(
  withBoundMutationActor(codex.defs.mutations.upsertTokenUsage),
);
export const interruptTurn = mutation(
  withBoundMutationActor(codex.defs.mutations.interruptTurn),
);
export const upsertPendingServerRequest = mutation(
  withBoundMutationActor(codex.defs.mutations.upsertPendingServerRequest),
);
export const resolvePendingServerRequest = mutation(
  withBoundMutationActor(codex.defs.mutations.resolvePendingServerRequest),
);
export const acceptTurnSend = mutation(
  withBoundMutationActor(codex.defs.mutations.acceptTurnSend),
);
export const failAcceptedTurnSend = mutation(
  withBoundMutationActor(codex.defs.mutations.failAcceptedTurnSend),
);

export const validateHostWiring = query(
  withBoundQueryActor(codex.defs.queries.validateHostWiring),
);
export const threadSnapshot = query(
  withBoundQueryActor(codex.defs.queries.threadSnapshot),
);
export const threadSnapshotSafe = query(
  withBoundQueryActor(codex.defs.queries.threadSnapshotSafe),
);
export const persistenceStats = query(
  withBoundQueryActor(codex.defs.queries.persistenceStats),
);
export const durableHistoryStats = query(
  withBoundQueryActor(codex.defs.queries.durableHistoryStats),
);
export const listThreadMessages = query(
  withBoundQueryActor(codex.defs.queries.listThreadMessages),
);
export const listTurnMessages = query(
  withBoundQueryActor(codex.defs.queries.listTurnMessages),
);
export const listPendingApprovals = query(
  withBoundQueryActor(codex.defs.queries.listPendingApprovals),
);
export const listTokenUsage = query(
  withBoundQueryActor(codex.defs.queries.listTokenUsage),
);
export const listPendingServerRequests = query(
  withBoundQueryActor(codex.defs.queries.listPendingServerRequests),
);

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
