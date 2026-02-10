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
  listThreadMessagesForHooksWithTrustedActor,
  listTurnMessagesForHooksWithTrustedActor,
  persistenceStats as persistenceStatsHandler,
  registerTurnStart as registerTurnStartHandler,
  respondApprovalForHooksWithTrustedActor,
  threadSnapshot as threadSnapshotHandler,
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
