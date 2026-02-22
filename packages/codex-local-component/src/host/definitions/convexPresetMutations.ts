/**
 * Mutation definitions for the Codex host preset slice.
 * Extracted from convexPreset.ts for file-size compliance.
 */
import { v } from "convex/values";
import {
  appendConversationSyncSourceChunkForActor,
  cancelConversationSyncJobForActor,
  ensureSession as ensureSessionHandler,
  ensureConversationBindingByResolve,
  forceRebindConversationSyncForActor,
  ingestBatchMixed,
  ingestBatchStreamOnly,
  ingestEventMixed,
  ingestEventStreamOnly,
  interruptTurnForHooksForActor,
  markConversationSyncProgressForActor,
  resolveThreadByConversationIdForActor,
  resolvePendingServerRequestForHooksForActor,
  respondApprovalForHooksForActor,
  syncOpenConversationBindingForActor,
  startConversationSyncSourceForActor,
  sealConversationSyncSourceForActor,
  upsertPendingServerRequestForHooksForActor,
  upsertTokenUsageForActor,
  vHostActorContext,
  vHostEnsureSessionResult,
  vHostIngestSafeResult,
  vHostLifecycleInboundEvent,
  vHostStreamInboundEvent,
  vHostSyncRuntimeOptions,
  type CodexHostComponentRefs,
  type HostActorContext,
  type HostMutationRunner,
  type HostQueryRunner,
} from "../convexSlice.js";
import { resolveHostActor, withResolvedHostActor } from "./actorResolution.js";
import type { CodexHostSliceFeatures, CodexHostSliceIngestMode } from "./convexPreset.js";

type MutationBuilderArgs = {
  component: CodexHostComponentRefs;
  serverActor: HostActorContext;
  ingestMode: CodexHostSliceIngestMode;
  features: Required<CodexHostSliceFeatures>;
};

export function buildPresetMutations(opts: MutationBuilderArgs) {
  const { component, serverActor, ingestMode, features } = opts;
  const resolveThreadIdOrThrow = async (
    ctx: HostQueryRunner,
    args: { actor: HostActorContext; conversationId: string },
  ): Promise<string> => {
    const mapping = await resolveThreadByConversationIdForActor(
      ctx,
      component,
      withResolvedHostActor(args, serverActor),
    );
    if (!mapping) {
      throw new Error(`[E_CONVERSATION_NOT_FOUND] Conversation not found: ${args.conversationId}`);
    }
    return mapping.threadId;
  };

  const ensureConversationBinding = {
    args: {
      actor: vHostActorContext,
      conversationId: v.string(),
      model: v.optional(v.string()),
      cwd: v.optional(v.string()),
    },
    returns: v.object({
      threadId: v.string(),
      created: v.optional(v.boolean()),
    }),
    handler: async (ctx: HostMutationRunner & HostQueryRunner, args: {
      actor: HostActorContext;
      conversationId: string;
      model?: string;
      cwd?: string;
    }) => {
      if (!args.conversationId) {
        throw new Error("ensureConversationBinding requires conversationId.");
      }
      const resolved = await ensureConversationBindingByResolve(
        ctx,
        component,
        withResolvedHostActor(
          {
            actor: args.actor,
            conversationId: args.conversationId,
            ...(args.model !== undefined ? { model: args.model } : {}),
            ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
          },
          serverActor,
        ),
      );
      return {
        threadId: resolved.threadId,
        ...(typeof resolved.created === "boolean"
          ? { created: resolved.created }
          : {}),
      };
    },
  };

  const ingestEvent = {
    args: {
      actor: vHostActorContext,
      sessionId: v.string(),
      threadId: v.string(),
      event: v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent),
    },
    returns: vHostIngestSafeResult,
    handler: async (
      ctx: HostMutationRunner & HostQueryRunner,
      args: {
        actor: HostActorContext;
        sessionId: string;
        threadId: string;
        event:
          | {
              type: "stream_delta";
              eventId: string;
              turnId: string;
              streamId: string;
              kind: string;
              payloadJson: string;
              cursorStart: number;
              cursorEnd: number;
              createdAt: number;
            }
          | {
              type: "lifecycle_event";
              eventId: string;
              turnId?: string;
              kind: string;
              payloadJson: string;
              createdAt: number;
            };
      },
    ) => {
      if (ingestMode === "mixed") {
        return ingestEventMixed(ctx, component, withResolvedHostActor(args, serverActor));
      }
      if (args.event.type === "lifecycle_event") {
        throw new Error("ingestEvent(streamOnly) does not accept lifecycle events");
      }
      return ingestEventStreamOnly(
        ctx,
        component,
        withResolvedHostActor({ ...args, event: args.event }, serverActor),
      );
    },
  };

  const ingestBatch = {
    args: {
      actor: vHostActorContext,
      sessionId: v.string(),
      threadId: v.string(),
      deltas: v.array(v.union(vHostStreamInboundEvent, vHostLifecycleInboundEvent)),
      runtime: v.optional(vHostSyncRuntimeOptions),
    },
    returns: vHostIngestSafeResult,
    handler: async (
      ctx: HostMutationRunner & HostQueryRunner,
      args: {
        actor: HostActorContext;
        sessionId: string;
        threadId: string;
        deltas: Array<
          | {
              type: "stream_delta";
              eventId: string;
              turnId: string;
              streamId: string;
              kind: string;
              payloadJson: string;
              cursorStart: number;
              cursorEnd: number;
              createdAt: number;
            }
          | {
              type: "lifecycle_event";
              eventId: string;
              turnId?: string;
              kind: string;
              payloadJson: string;
              createdAt: number;
            }
        >;
        runtime?: {
          saveStreamDeltas?: boolean;
          saveReasoningDeltas?: boolean;
          exposeRawReasoningDeltas?: boolean;
          maxDeltasPerStreamRead?: number;
          maxDeltasPerRequestRead?: number;
          finishedStreamDeleteDelayMs?: number;
        };
      },
    ) => {
      if (ingestMode === "mixed") {
        return ingestBatchMixed(ctx, component, withResolvedHostActor(args, serverActor));
      }
      const hasLifecycle = args.deltas.some((delta) => delta.type === "lifecycle_event");
      if (hasLifecycle) {
        throw new Error("ingestBatch(streamOnly) does not accept lifecycle events");
      }
      const streamDeltas = args.deltas
        .filter((delta): delta is Extract<(typeof args.deltas)[number], { type: "stream_delta" }> =>
          delta.type === "stream_delta")
        .map((delta) => ({
          eventId: delta.eventId,
          turnId: delta.turnId,
          streamId: delta.streamId,
          kind: delta.kind,
          payloadJson: delta.payloadJson,
          cursorStart: delta.cursorStart,
          cursorEnd: delta.cursorEnd,
          createdAt: delta.createdAt,
        }));
      return ingestBatchStreamOnly(
        ctx,
        component,
        withResolvedHostActor({ ...args, deltas: streamDeltas }, serverActor),
      );
    },
  };

  return {
    syncOpenConversationBinding: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        runtimeConversationId: v.optional(v.string()),
        model: v.optional(v.string()),
        cwd: v.optional(v.string()),
        sessionId: v.optional(v.string()),
      },
      returns: v.object({
        threadId: v.string(),
        created: v.boolean(),
        rebindApplied: v.boolean(),
        conversationId: v.string(),
        runtimeConversationId: v.string(),
        syncState: v.union(v.literal("unsynced"), v.literal("syncing"), v.literal("synced"), v.literal("drifted")),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string; runtimeConversationId?: string; model?: string; cwd?: string; sessionId?: string },
      ) => {
        const result = await syncOpenConversationBindingForActor(
          ctx,
          component,
          withResolvedHostActor(
            {
              actor: args.actor,
              conversationId: args.conversationId,
              runtimeConversationId: args.runtimeConversationId === undefined ? args.conversationId : args.runtimeConversationId,
              ...(args.model !== undefined ? { model: args.model } : {}),
              ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
              ...(args.sessionId !== undefined ? { sessionId: args.sessionId } : {}),
            },
            serverActor,
          ),
        );
        return {
          ...result,
          conversationId: args.conversationId,
        };
      },
    },
    markConversationSyncProgress: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        runtimeConversationId: v.optional(v.string()),
        sessionId: v.optional(v.string()),
        cursor: v.number(),
        syncState: v.optional(v.union(v.literal("unsynced"), v.literal("syncing"), v.literal("synced"), v.literal("drifted"))),
        errorCode: v.optional(v.string()),
        syncJobId: v.optional(v.string()),
        expectedSyncJobId: v.optional(v.string()),
        syncJobState: v.optional(v.union(v.literal("idle"), v.literal("syncing"), v.literal("synced"), v.literal("failed"), v.literal("cancelled"))),
        syncJobPolicyVersion: v.optional(v.number()),
        syncJobStartedAt: v.optional(v.number()),
        syncJobUpdatedAt: v.optional(v.number()),
        syncJobErrorCode: v.optional(v.string()),
      },
      returns: v.object({
        threadId: v.string(),
        conversationId: v.string(),
        runtimeConversationId: v.optional(v.string()),
        syncState: v.union(v.literal("unsynced"), v.literal("syncing"), v.literal("synced"), v.literal("drifted")),
        lastSyncedCursor: v.number(),
        syncJobId: v.optional(v.string()),
        syncJobState: v.optional(v.union(v.literal("idle"), v.literal("syncing"), v.literal("synced"), v.literal("failed"), v.literal("cancelled"))),
        syncJobPolicyVersion: v.optional(v.number()),
        syncJobStartedAt: v.optional(v.number()),
        syncJobUpdatedAt: v.optional(v.number()),
        syncJobLastCursor: v.optional(v.number()),
        syncJobErrorCode: v.optional(v.string()),
        staleIgnored: v.boolean(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          conversationId: string;
          runtimeConversationId?: string;
          sessionId?: string;
          cursor: number;
          syncState?: "unsynced" | "syncing" | "synced" | "drifted";
          errorCode?: string;
          syncJobId?: string;
          expectedSyncJobId?: string;
          syncJobState?: "idle" | "syncing" | "synced" | "failed" | "cancelled";
          syncJobPolicyVersion?: number;
          syncJobStartedAt?: number;
          syncJobUpdatedAt?: number;
          syncJobErrorCode?: string;
        },
      ) => {
        const result = await markConversationSyncProgressForActor(
          ctx,
          component,
          withResolvedHostActor(
            { ...args, conversationId: args.conversationId },
            serverActor,
          ),
        );
        return {
          ...result,
          conversationId: args.conversationId,
        };
      },
    },
    forceRebindConversationSync: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        runtimeConversationId: v.string(),
        reasonCode: v.optional(v.string()),
      },
      returns: v.object({
        threadId: v.string(),
        conversationId: v.string(),
        runtimeConversationId: v.string(),
        syncState: v.union(v.literal("unsynced"), v.literal("syncing"), v.literal("synced"), v.literal("drifted")),
        rebindCount: v.number(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string; runtimeConversationId: string; reasonCode?: string },
      ) => {
        const result = await forceRebindConversationSyncForActor(
          ctx,
          component,
          withResolvedHostActor(
            { ...args, conversationId: args.conversationId },
            serverActor,
          ),
        );
        return {
          ...result,
          conversationId: args.conversationId,
        };
      },
    },
    startConversationSyncSource: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        runtimeConversationId: v.optional(v.string()),
        threadId: v.optional(v.string()),
      },
      returns: v.object({
        sourceId: v.string(),
        conversationId: v.string(),
        threadId: v.string(),
        sourceState: v.union(v.literal("collecting"), v.literal("sealed"), v.literal("failed")),
        policyVersion: v.number(),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          conversationId: string;
          runtimeConversationId?: string;
          threadId?: string;
        },
      ) =>
        startConversationSyncSourceForActor(
          ctx,
          component,
          withResolvedHostActor(args, serverActor),
        ),
    },
    appendConversationSyncSourceChunk: {
      args: {
        actor: vHostActorContext,
        sourceId: v.string(),
        chunkIndex: v.number(),
        payloadJson: v.string(),
        messageCount: v.number(),
        byteSize: v.number(),
      },
      returns: v.object({
        sourceId: v.string(),
        chunkIndex: v.number(),
        appended: v.boolean(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          sourceId: string;
          chunkIndex: number;
          payloadJson: string;
          messageCount: number;
          byteSize: number;
        },
      ) =>
        appendConversationSyncSourceChunkForActor(
          ctx,
          component,
          withResolvedHostActor(args, serverActor),
        ),
    },
    sealConversationSyncSource: {
      args: {
        actor: vHostActorContext,
        sourceId: v.string(),
        expectedManifestJson: v.string(),
        expectedChecksum: v.string(),
        expectedMessageCount: v.optional(v.number()),
      },
      returns: v.object({
        sourceId: v.string(),
        jobId: v.string(),
        sourceState: v.union(v.literal("collecting"), v.literal("sealed"), v.literal("failed")),
        totalChunks: v.number(),
        scheduled: v.boolean(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; sourceId: string; expectedManifestJson: string; expectedChecksum: string; expectedMessageCount?: number },
      ) =>
        sealConversationSyncSourceForActor(
          ctx,
          component,
          withResolvedHostActor(args, serverActor),
        ),
    },
    cancelConversationSyncJob: {
      args: {
        actor: vHostActorContext,
        jobId: v.string(),
        errorCode: v.optional(v.string()),
        errorMessage: v.optional(v.string()),
      },
      returns: v.object({
        jobId: v.string(),
        state: v.union(v.literal("syncing"), v.literal("synced"), v.literal("failed"), v.literal("cancelled")),
        cancelled: v.boolean(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; jobId: string; errorCode?: string; errorMessage?: string },
      ) =>
        cancelConversationSyncJobForActor(
          ctx,
          component,
          withResolvedHostActor(args, serverActor),
        ),
    },
    ensureConversationBinding,
    archiveConversation: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
      },
      returns: v.object({
        conversationId: v.string(),
        status: v.literal("archived"),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        if (!component.threads.resolveByConversationId) {
          throw new Error("Host component is missing threads.resolveByConversationId.");
        }
        if (!component.threads.archiveByConversation) {
          throw new Error("Host component is missing threads.archiveByConversation.");
        }
        const mapping = await ctx.runQuery(component.threads.resolveByConversationId, {
          actor,
          conversationId: args.conversationId,
        });
        if (!mapping) {
          throw new Error(`[E_CONVERSATION_NOT_FOUND] Conversation not found: ${args.conversationId}`);
        }
        return ctx.runMutation(component.threads.archiveByConversation, {
          actor,
          conversationId: args.conversationId,
          threadId: mapping.threadId,
        });
      },
    },
    unarchiveConversation: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
      },
      returns: v.object({
        conversationId: v.string(),
        status: v.literal("active"),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        if (!component.threads.resolveByConversationId) {
          throw new Error("Host component is missing threads.resolveByConversationId.");
        }
        if (!component.threads.unarchiveByConversation) {
          throw new Error("Host component is missing threads.unarchiveByConversation.");
        }
        const mapping = await ctx.runQuery(component.threads.resolveByConversationId, {
          actor,
          conversationId: args.conversationId,
        });
        if (!mapping) {
          throw new Error(`[E_CONVERSATION_NOT_FOUND] Conversation not found: ${args.conversationId}`);
        }
        return ctx.runMutation(component.threads.unarchiveByConversation, {
          actor,
          conversationId: args.conversationId,
          threadId: mapping.threadId,
        });
      },
    },
    ensureSession: {
      args: {
        actor: vHostActorContext,
        sessionId: v.string(),
        threadId: v.string(),
        lastEventCursor: v.number(),
      },
      returns: vHostEnsureSessionResult,
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; sessionId: string; threadId: string; lastEventCursor: number },
      ) => ensureSessionHandler(ctx, component, withResolvedHostActor(args, serverActor)),
    },
    ingestEvent,
    ingestBatch,
    deleteThread: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        reason: v.optional(v.string()),
        batchSize: v.optional(v.number()),
      },
      returns: v.object({ deletionJobId: v.string() }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string; reason?: string; batchSize?: number },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        const threadId = await resolveThreadIdOrThrow(ctx, args);
        return ctx.runMutation(component.threads.deleteCascade, {
          actor,
          threadId,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
          ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
        });
      },
    },
    scheduleDeleteThread: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        reason: v.optional(v.string()),
        batchSize: v.optional(v.number()),
        delayMs: v.optional(v.number()),
      },
      returns: v.object({
        deletionJobId: v.string(),
        scheduledFor: v.number(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; conversationId: string; reason?: string; batchSize?: number; delayMs?: number },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        const threadId = await resolveThreadIdOrThrow(ctx, args);
        return ctx.runMutation(component.threads.scheduleDeleteCascade, {
          actor,
          threadId,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
          ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
          ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
        });
      },
    },
    deleteTurn: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        turnId: v.string(),
        reason: v.optional(v.string()),
        batchSize: v.optional(v.number()),
      },
      returns: v.object({ deletionJobId: v.string() }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          conversationId: string;
          turnId: string;
          reason?: string;
          batchSize?: number;
        },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        const threadId = await resolveThreadIdOrThrow(ctx, args);
        return ctx.runMutation(component.turns.deleteCascade, {
          actor,
          threadId,
          turnId: args.turnId,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
          ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
        });
      },
    },
    scheduleDeleteTurn: {
      args: {
        actor: vHostActorContext,
        conversationId: v.string(),
        turnId: v.string(),
        reason: v.optional(v.string()),
        batchSize: v.optional(v.number()),
        delayMs: v.optional(v.number()),
      },
      returns: v.object({
        deletionJobId: v.string(),
        scheduledFor: v.number(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          conversationId: string;
          turnId: string;
          reason?: string;
          batchSize?: number;
          delayMs?: number;
        },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        const threadId = await resolveThreadIdOrThrow(ctx, args);
        return ctx.runMutation(component.turns.scheduleDeleteCascade, {
          actor,
          threadId,
          turnId: args.turnId,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
          ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
          ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
        });
      },
    },
    purgeActorData: {
      args: {
        actor: vHostActorContext,
        reason: v.optional(v.string()),
        batchSize: v.optional(v.number()),
      },
      returns: v.object({ deletionJobId: v.string() }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; reason?: string; batchSize?: number },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        return ctx.runMutation(component.threads.purgeActorData, {
          actor,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
          ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
        });
      },
    },
    schedulePurgeActorData: {
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
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; reason?: string; batchSize?: number; delayMs?: number },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        return ctx.runMutation(component.threads.schedulePurgeActorData, {
          actor,
          ...(args.reason !== undefined ? { reason: args.reason } : {}),
          ...(args.batchSize !== undefined ? { batchSize: args.batchSize } : {}),
          ...(args.delayMs !== undefined ? { delayMs: args.delayMs } : {}),
        });
      },
    },
    cancelDeletion: {
      args: {
        actor: vHostActorContext,
        deletionJobId: v.string(),
      },
      returns: v.object({
        deletionJobId: v.string(),
        cancelled: v.boolean(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; deletionJobId: string },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        return ctx.runMutation(component.threads.cancelScheduledDeletion, {
          actor,
          deletionJobId: args.deletionJobId,
        });
      },
    },
    forceRunDeletion: {
      args: {
        actor: vHostActorContext,
        deletionJobId: v.string(),
      },
      returns: v.object({
        deletionJobId: v.string(),
        forced: v.boolean(),
      }),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: { actor: HostActorContext; deletionJobId: string },
      ) => {
        const actor = resolveHostActor(args.actor, serverActor);
        return ctx.runMutation(component.threads.forceRunScheduledDeletion, {
          actor,
          deletionJobId: args.deletionJobId,
        });
      },
    },
    ...(features.approvals
      ? {
          respondApprovalForHooks: {
            args: {
              actor: vHostActorContext,
              conversationId: v.string(),
              turnId: v.string(),
              itemId: v.string(),
              decision: v.union(v.literal("accepted"), v.literal("declined")),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: { actor: HostActorContext; conversationId: string; turnId: string; itemId: string; decision: "accepted" | "declined" },
            ) => {
              const threadId = await resolveThreadIdOrThrow(ctx, args);
              return respondApprovalForHooksForActor(
                ctx,
                component,
                withResolvedHostActor({ ...args, threadId }, serverActor),
              );
            },
          },
        }
      : {}),
    ...(features.serverRequests
      ? {
          upsertPendingServerRequestForHooks: {
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
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: {
                actor: HostActorContext;
                requestId: string | number;
                threadId: string;
                turnId: string;
                itemId: string;
                method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval" | "item/tool/requestUserInput" | "item/tool/call";
                payloadJson: string;
                reason?: string;
                questionsJson?: string;
                requestedAt: number;
              },
            ) =>
              upsertPendingServerRequestForHooksForActor(
                ctx,
                component,
                withResolvedHostActor(args, serverActor),
              ),
          },
          resolvePendingServerRequestForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              requestId: v.union(v.string(), v.number()),
              status: v.union(v.literal("answered"), v.literal("expired")),
              resolvedAt: v.number(),
              responseJson: v.optional(v.string()),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                requestId: string | number;
                status: "answered" | "expired";
                resolvedAt: number;
                responseJson?: string;
              },
            ) =>
              resolvePendingServerRequestForHooksForActor(
                ctx,
                component,
                withResolvedHostActor(args, serverActor),
              ),
          },
        }
      : {}),
    ...(features.hooks
      ? {
          interruptTurnForHooks: {
            args: {
              actor: vHostActorContext,
              conversationId: v.string(),
              turnId: v.string(),
              reason: v.optional(v.string()),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: { actor: HostActorContext; conversationId: string; turnId: string; reason?: string },
            ) => {
              const threadId = await resolveThreadIdOrThrow(ctx, args);
              return interruptTurnForHooksForActor(
                ctx,
                component,
                withResolvedHostActor({ ...args, threadId }, serverActor),
              );
            },
          },
        }
      : {}),
    ...(features.tokenUsage
      ? {
          upsertTokenUsageForHooks: {
            args: {
              actor: vHostActorContext,
              threadId: v.string(),
              turnId: v.string(),
              totalTokens: v.number(),
              inputTokens: v.number(),
              cachedInputTokens: v.number(),
              outputTokens: v.number(),
              reasoningOutputTokens: v.number(),
              lastTotalTokens: v.number(),
              lastInputTokens: v.number(),
              lastCachedInputTokens: v.number(),
              lastOutputTokens: v.number(),
              lastReasoningOutputTokens: v.number(),
              modelContextWindow: v.optional(v.number()),
            },
            returns: v.null(),
            handler: async (
              ctx: HostMutationRunner & HostQueryRunner,
              args: {
                actor: HostActorContext;
                threadId: string;
                turnId: string;
                totalTokens: number;
                inputTokens: number;
                cachedInputTokens: number;
                outputTokens: number;
                reasoningOutputTokens: number;
                lastTotalTokens: number;
                lastInputTokens: number;
                lastCachedInputTokens: number;
                lastOutputTokens: number;
                lastReasoningOutputTokens: number;
                modelContextWindow?: number;
              },
            ) =>
              upsertTokenUsageForActor(
                ctx,
                component,
                withResolvedHostActor(args, serverActor),
              ),
          },
        }
      : {}),
    acceptTurnSendForHooks: {
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
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          turnId: string;
          idempotencyKey: string;
          inputText: string;
          dispatchId?: string;
        },
      ) => {
        const resolvedActor = resolveHostActor(args.actor, serverActor);
        await ctx.runMutation(component.turns.start, {
          actor: resolvedActor,
          threadId: args.threadId,
          turnId: args.turnId,
          idempotencyKey: args.idempotencyKey,
          input: [{ type: "text", text: args.inputText }],
        });
        return {
          dispatchId: args.dispatchId ?? args.turnId,
          turnId: args.turnId,
          accepted: true as const,
        };
      },
    },
    failAcceptedTurnSendForHooks: {
      args: {
        actor: vHostActorContext,
        threadId: v.string(),
        turnId: v.string(),
        dispatchId: v.optional(v.string()),
        code: v.optional(v.string()),
        reason: v.string(),
      },
      returns: v.null(),
      handler: async (
        ctx: HostMutationRunner & HostQueryRunner,
        args: {
          actor: HostActorContext;
          threadId: string;
          turnId: string;
          dispatchId?: string;
          code?: string;
          reason: string;
        },
      ) => {
        const resolvedActor = resolveHostActor(args.actor, serverActor);
        await ctx.runMutation(component.turns.interrupt, {
          actor: resolvedActor,
          threadId: args.threadId,
          turnId: args.turnId,
          reason: args.code ? `[${args.code}] ${args.reason}` : args.reason,
        });
        return null;
      },
    },
  };
}
