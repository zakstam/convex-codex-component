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
  SERVER_ACTOR_POLICY,
  requireBoundServerActorForMutation,
  requireBoundServerActorForQuery,
} from "./actorLock";
export { getActorBindingForBootstrap, listThreadsForPicker } from "./chat.extensions";

const codex = createCodexHost({
  components,
  mutation,
  query,
  actorPolicy: SERVER_ACTOR_POLICY,
  actorResolver: {
    mutation: async (ctx, actor) =>
      requireBoundServerActorForMutation(ctx as MutationCtx, actor),
    query: async (ctx, actor) =>
      requireBoundServerActorForQuery(ctx as QueryCtx, actor),
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

export const ensureSession = codex.endpoints.ensureSession;
export const ingestEvent = codex.endpoints.ingestEvent;
export const ingestBatch = codex.endpoints.ingestBatch;
export const respondApproval = codex.endpoints.respondApproval;
export const upsertTokenUsage = codex.endpoints.upsertTokenUsage;
export const interruptTurn = codex.endpoints.interruptTurn;
export const upsertPendingServerRequest = codex.endpoints.upsertPendingServerRequest;
export const resolvePendingServerRequest = codex.endpoints.resolvePendingServerRequest;
export const acceptTurnSend = codex.endpoints.acceptTurnSend;
export const failAcceptedTurnSend = codex.endpoints.failAcceptedTurnSend;

export const validateHostWiring = codex.endpoints.validateHostWiring;
export const threadSnapshot = codex.endpoints.threadSnapshot;
export const threadSnapshotSafe = codex.endpoints.threadSnapshotSafe;
export const persistenceStats = codex.endpoints.persistenceStats;
export const durableHistoryStats = codex.endpoints.durableHistoryStats;
export const listThreadMessages = codex.endpoints.listThreadMessages;
export const listTurnMessages = codex.endpoints.listTurnMessages;
export const listPendingApprovals = codex.endpoints.listPendingApprovals;
export const listTokenUsage = codex.endpoints.listTokenUsage;
export const listPendingServerRequests = codex.endpoints.listPendingServerRequests;

export const deleteThread = codex.endpoints.deleteThread;
export const scheduleDeleteThread = codex.endpoints.scheduleDeleteThread;
export const deleteTurn = codex.endpoints.deleteTurn;
export const scheduleDeleteTurn = codex.endpoints.scheduleDeleteTurn;
export const purgeActorData = codex.endpoints.purgeActorData;
export const schedulePurgeActorData = codex.endpoints.schedulePurgeActorData;
export const cancelDeletion = codex.endpoints.cancelDeletion;
export const forceRunDeletion = codex.endpoints.forceRunDeletion;
export const getDeletionStatus = codex.endpoints.getDeletionStatus;
