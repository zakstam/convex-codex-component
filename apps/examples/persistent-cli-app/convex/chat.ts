import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import {
  enqueueTurnDispatchForActor,
  durableHistoryStats as durableHistoryStatsHandler,
  ensureSession as ensureSessionHandler,
  ensureThreadByCreate,
  ingestBatchStreamOnly,
  ingestEventStreamOnly,
  interruptTurnForHooksForActor,
  listPendingApprovalsForHooksForActor,
  listThreadMessagesForHooksForActor,
  listTurnMessagesForHooksForActor,
  persistenceStats as persistenceStatsHandler,
  respondApprovalForHooksForActor,
  threadSnapshot as threadSnapshotHandler,
  vHostActorContext,
  vHostDurableHistoryStats,
  vHostEnqueueTurnDispatchResult,
  vHostEnsureSessionResult,
  vHostInboundEvent,
  vHostIngestSafeResult,
  vHostPersistenceStats,
  vHostStreamArgs,
  vHostSyncRuntimeOptions,
  vHostTurnInput,
  type HostActorContext,
} from "@zakstam/codex-local-component/host/convex";

const SERVER_ACTOR: HostActorContext = Object.freeze({
  tenantId: process.env.ACTOR_TENANT_ID ?? "demo-tenant",
  userId: process.env.ACTOR_USER_ID ?? "demo-user",
  deviceId: process.env.ACTOR_DEVICE_ID ?? "persistent-cli-server-device",
});

function withServerActor<T extends { actor: HostActorContext }>(args: T): T {
  return { ...args, actor: SERVER_ACTOR };
}

export const ensureThread = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    model: v.optional(v.string()),
    cwd: v.optional(v.string()),
  },
  handler: async (ctx, args) => ensureThreadByCreate(ctx, components.codexLocal, withServerActor(args)),
});

export const enqueueTurnDispatch = mutation({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
    dispatchId: v.optional(v.string()),
    turnId: v.string(),
    idempotencyKey: v.string(),
    input: vHostTurnInput,
  },
  returns: vHostEnqueueTurnDispatchResult,
  handler: async (ctx, args) =>
    enqueueTurnDispatchForActor(ctx, components.codexLocal, withServerActor(args)),
});

export const ensureSession = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
  },
  returns: vHostEnsureSessionResult,
  handler: async (ctx, args) => ensureSessionHandler(ctx, components.codexLocal, withServerActor(args)),
});

export const ingestEvent = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    event: vHostInboundEvent,
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) =>
    ingestEventStreamOnly(ctx, components.codexLocal, withServerActor(args)),
});

export const ingestBatch = mutation({
  args: {
    actor: vHostActorContext,
    sessionId: v.string(),
    threadId: v.string(),
    deltas: v.array(vHostInboundEvent),
    runtime: v.optional(vHostSyncRuntimeOptions),
  },
  returns: vHostIngestSafeResult,
  handler: async (ctx, args) =>
    ingestBatchStreamOnly(ctx, components.codexLocal, withServerActor(args)),
});

export const threadSnapshot = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  handler: async (ctx, args) => threadSnapshotHandler(ctx, components.codexLocal, withServerActor(args)),
});

export const persistenceStats = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostPersistenceStats,
  handler: async (ctx, args) =>
    persistenceStatsHandler(ctx, components.codexLocal, withServerActor(args)),
});

export const durableHistoryStats = query({
  args: {
    actor: vHostActorContext,
    threadId: v.string(),
  },
  returns: vHostDurableHistoryStats,
  handler: async (ctx, args) =>
    durableHistoryStatsHandler(ctx, components.codexLocal, withServerActor(args)),
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
    listThreadMessagesForHooksForActor(ctx, components.codexLocal, {
      actor: SERVER_ACTOR,
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
    listTurnMessagesForHooksForActor(ctx, components.codexLocal, withServerActor(args)),
});

export const listPendingApprovalsForHooks = query({
  args: {
    actor: vHostActorContext,
    threadId: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) =>
    listPendingApprovalsForHooksForActor(ctx, components.codexLocal, withServerActor(args)),
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
    respondApprovalForHooksForActor(ctx, components.codexLocal, withServerActor(args)),
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
    interruptTurnForHooksForActor(ctx, components.codexLocal, withServerActor(args)),
});
