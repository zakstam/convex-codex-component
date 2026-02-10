import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  durableHistoryStats as durableHistoryStatsHandler,
  ensureSession as ensureSessionHandler,
  ensureThreadByResolve,
  ingestBatchMixed,
  ingestEventMixed,
  interruptTurnForHooksWithTrustedActor,
  listPendingApprovalsForHooksWithTrustedActor,
  listPendingServerRequestsForHooksWithTrustedActor,
  listThreadMessagesForHooksWithTrustedActor,
  listTurnMessagesForHooksWithTrustedActor,
  persistenceStats as persistenceStatsHandler,
  registerTurnStart as registerTurnStartHandler,
  respondApprovalForHooksWithTrustedActor,
  resolvePendingServerRequestForHooksWithTrustedActor,
  threadSnapshot as threadSnapshotHandler,
  upsertPendingServerRequestForHooksWithTrustedActor,
  vHostActorContext,
  vHostDurableHistoryStats,
  vHostEnsureSessionResult,
  vHostIngestSafeResult,
  vHostLifecycleInboundEvent,
  vHostPersistenceStats,
  vHostStreamArgs,
  vHostStreamInboundEvent,
  vHostSyncRuntimeOptions,
} from "@zakstam/codex-local-component/host/convex";

export const ensureThread = mutation({
  args: {
    actor: vHostActorContext,
    externalThreadId: v.optional(v.string()),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => ensureThreadByResolve(ctx, components.codexLocal, args),
});

export const registerTurnStart = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    inputText: v.string(),
    idempotencyKey: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => registerTurnStartHandler(ctx, components.codexLocal, args),
});

export const ensureSession = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
  },
  returns: vHostEnsureSessionResult,
  handler: async (ctx, args) => ensureSessionHandler(ctx, components.codexLocal, args),
});

export const ingestEvent = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    event: v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent),
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) => ingestEventMixed(ctx, components.codexLocal, args),
});

export const ingestBatch = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent)),
    runtime: v.optional(vHostSyncRuntimeOptions),
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) => ingestBatchMixed(ctx, components.codexLocal, args),
});

export const threadSnapshot = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => threadSnapshotHandler(ctx, components.codexLocal, args),
});

export const listThreadsForPicker = query({
  args: {
    actor: vHostActorContext,
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const listed = await ctx.runQuery(components.codexLocal.threads.list, {
      actor: args.actor,
      paginationOpts: {
        numItems: Math.max(1, Math.floor(args.limit ?? 25)),
        cursor: null,
      },
    });

    const page = listed.page as Array<{
      threadId: string;
      status: string;
      updatedAt: number;
    }>;

    const rows = await Promise.all(
      page.map(async (thread) => {
        const mapping = await ctx.runQuery(components.codexLocal.threads.getExternalMapping, {
          actor: args.actor,
          threadId: thread.threadId,
        });
        return {
          threadId: thread.threadId,
          status: thread.status,
          updatedAt: thread.updatedAt,
          runtimeThreadId: mapping?.externalThreadId ?? null,
        };
      }),
    );

    return {
      threads: rows,
      hasMore: !listed.isDone,
      continueCursor: listed.continueCursor,
    };
  },
});

export const persistenceStats = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostPersistenceStats,
  handler: async (ctx, args) => persistenceStatsHandler(ctx, components.codexLocal, args),
});

export const durableHistoryStats = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostDurableHistoryStats,
  handler: async (ctx, args) => durableHistoryStatsHandler(ctx, components.codexLocal, args),
});

export const listThreadMessagesForHooks = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
    streamArgs: vHostStreamArgs,
    runtime: v.optional(vHostSyncRuntimeOptions),
  },
  handler: async (ctx, args) =>
    listThreadMessagesForHooksWithTrustedActor(ctx, components.codexLocal, {
      actor: args.actor,
      threadId: args.threadId,
      paginationOpts: args.paginationOpts,
      ...(args.streamArgs !== undefined ? { streamArgs: args.streamArgs } : {}),
      ...(args.runtime !== undefined ? { runtime: args.runtime } : {}),
    }),
});

export const listTurnMessagesForHooks = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
  },
  handler: async (ctx, args) =>
    listTurnMessagesForHooksWithTrustedActor(ctx, components.codexLocal, args),
});

export const listPendingApprovalsForHooks = query({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) =>
    listPendingApprovalsForHooksWithTrustedActor(ctx, components.codexLocal, args),
});

export const respondApprovalForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    itemId: v.string(),
    decision: v.union(v.literal("accepted"), v.literal("declined")),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    respondApprovalForHooksWithTrustedActor(ctx, components.codexLocal, args),
});

export const listPendingServerRequestsForHooks = query({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) =>
    listPendingServerRequestsForHooksWithTrustedActor(ctx, components.codexLocal, args),
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
    requestedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    upsertPendingServerRequestForHooksWithTrustedActor(ctx, components.codexLocal, args),
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
  handler: async (ctx, args) =>
    resolvePendingServerRequestForHooksWithTrustedActor(ctx, components.codexLocal, args),
});

export const interruptTurnForHooks = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    turnId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) =>
    interruptTurnForHooksWithTrustedActor(ctx, components.codexLocal, args),
});
