import { mutation, query } from "./_generated/server";
import { components } from "./_generated/api";
import { defineDispatchManagedHostSlice } from "@zakstam/codex-local-component/host/convex";
import {
  SERVER_ACTOR,
  requireBoundServerActorForMutation,
  requireBoundServerActorForQuery,
} from "./actorLock";
export { getActorBindingForBootstrap, listThreadsForPicker } from "./chat.extensions";

const defs = defineDispatchManagedHostSlice({
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

export const enqueueTurnDispatch = mutation({
  ...defs.mutations.enqueueTurnDispatch,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.enqueueTurnDispatch.handler(ctx, args);
  },
});

export const claimNextTurnDispatch = mutation({
  ...defs.mutations.claimNextTurnDispatch,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.claimNextTurnDispatch.handler(ctx, args);
  },
});

export const markTurnDispatchStarted = mutation({
  ...defs.mutations.markTurnDispatchStarted,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.markTurnDispatchStarted.handler(ctx, args);
  },
});

export const markTurnDispatchCompleted = mutation({
  ...defs.mutations.markTurnDispatchCompleted,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.markTurnDispatchCompleted.handler(ctx, args);
  },
});

export const markTurnDispatchFailed = mutation({
  ...defs.mutations.markTurnDispatchFailed,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.markTurnDispatchFailed.handler(ctx, args);
  },
});

export const cancelTurnDispatch = mutation({
  ...defs.mutations.cancelTurnDispatch,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.cancelTurnDispatch.handler(ctx, args);
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

export const upsertPendingServerRequestForHooks = mutation({
  ...defs.mutations.upsertPendingServerRequestForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.upsertPendingServerRequestForHooks.handler(ctx, args);
  },
});

export const resolvePendingServerRequestForHooks = mutation({
  ...defs.mutations.resolvePendingServerRequestForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.resolvePendingServerRequestForHooks.handler(ctx, args);
  },
});

export const upsertTokenUsageForHooks = mutation({
  ...defs.mutations.upsertTokenUsageForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.upsertTokenUsageForHooks.handler(ctx, args);
  },
});

export const interruptTurnForHooks = mutation({
  ...defs.mutations.interruptTurnForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForMutation(ctx, args.actor);
    return defs.mutations.interruptTurnForHooks.handler(ctx, args);
  },
});

export const validateHostWiring = query({
  ...defs.queries.validateHostWiring,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.validateHostWiring.handler(ctx, args);
  },
});

export const getTurnDispatchState = query({
  ...defs.queries.getTurnDispatchState,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.getTurnDispatchState.handler(ctx, args);
  },
});

export const getDispatchObservability = query({
  ...defs.queries.getDispatchObservability,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.getDispatchObservability.handler(ctx, args);
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

export const listThreadReasoningForHooks = query({
  ...defs.queries.listThreadReasoningForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listThreadReasoningForHooks.handler(ctx, args);
  },
});

export const listPendingApprovalsForHooks = query({
  ...defs.queries.listPendingApprovalsForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listPendingApprovalsForHooks.handler(ctx, args);
  },
});

export const listPendingServerRequestsForHooks = query({
  ...defs.queries.listPendingServerRequestsForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listPendingServerRequestsForHooks.handler(ctx, args);
  },
});

export const listTokenUsageForHooks = query({
  ...defs.queries.listTokenUsageForHooks,
  handler: async (ctx, args) => {
    await requireBoundServerActorForQuery(ctx, args.actor);
    return defs.queries.listTokenUsageForHooks.handler(ctx, args);
  },
});
